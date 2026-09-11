import {describe, expect, spyOn, test} from "bun:test"
import {StorybookBuildScheduler, type StorybookBuildRequest} from "./build-scheduler.ts"
import {parseStorybookProcessResourceRows} from "./resource-usage.ts"

const request = (operationId: string, packageId = `@fixture/${operationId}`): StorybookBuildRequest => ({
  operationId,
  packageId,
  owner: "check",
  reason: "missing",
  generation: 1,
  cache: {status: "miss", layer: "package"},
})

describe("Storybook build scheduler observability", () => {
  test("pushes immutable queue, admission, phase and completion transitions", async () => {
    const scheduler = new StorybookBuildScheduler({limit: 1})
    const transitions: Readonly<Record<string, unknown>>[] = []
    const unsubscribe = scheduler.subscribe((transition) => transitions.push(transition))
    await scheduler.run(request("transition"), async ({setPhase}) => {
      setPhase("fingerprint")
      setPhase("fingerprint")
    }, new AbortController().signal)
    unsubscribe()
    expect(transitions.map(({state, phase, outcome}) => [state, phase, outcome])).toEqual([
      ["queued", "admission", undefined],
      ["running", "admission", undefined],
      ["running", "fingerprint", undefined],
      ["completed", "fingerprint", "completed"],
    ])
    expect(transitions.every(Object.isFrozen)).toBeTrue()
    expect(JSON.stringify(transitions)).not.toContain('"pid"')
  })

  test("публикует подтверждённый cache outcome без новой операции", async () => {
    const scheduler = new StorybookBuildScheduler({limit: 1})
    const transitions: Readonly<Record<string, unknown>>[] = []
    scheduler.subscribe(transition => transitions.push(transition))

    await scheduler.run(request("cache"), async ({setCacheOutcome}) => {
      setCacheOutcome?.({status: "hit", layer: "shared"})
    }, new AbortController().signal)

    expect(transitions.map(({state, phase, cache}) => [state, phase, cache])).toEqual([
      ["queued", "admission", {status: "miss", layer: "package"}],
      ["running", "admission", {status: "miss", layer: "package"}],
      ["running", "admission", {status: "hit", layer: "shared"}],
      ["completed", "admission", {status: "hit", layer: "shared"}],
    ])
  })

  test("isolates a failing transition listener from the build", async () => {
    const scheduler = new StorybookBuildScheduler({limit: 1})
    const errors = spyOn(console, "error").mockImplementation(() => {})
    scheduler.subscribe(() => { throw new Error("UI listener failed") })
    await expect(scheduler.run(request("listener-failure"), async () => "built", new AbortController().signal))
      .resolves.toBe("built")
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })

  test("keeps queued work outside the CPU slot and publishes consistent timing", async () => {
    let now = Date.parse("2026-09-11T08:00:00.000Z")
    const scheduler = new StorybookBuildScheduler({limit: 1, now: () => now})
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolvePromise) => { releaseFirst = resolvePromise })
    let secondStarted = false
    const first = scheduler.run(request("first"), async () => {
      await firstGate
    }, new AbortController().signal)
    const second = scheduler.run(request("second"), async () => {
      secondStarted = true
    }, new AbortController().signal)
    await Bun.sleep(0)
    now += 250
    const queued = scheduler.snapshot()
    expect(queued.activeCount).toBe(1)
    expect(queued.queuedCount).toBe(1)
    expect(queued.queued[0]).toMatchObject({
      operationId: "second",
      state: "queued",
      startedAt: null,
      queueDurationMs: 250,
      executionDurationMs: 0,
    })
    expect(secondStarted).toBeFalse()
    releaseFirst()
    await Promise.all([first, second])
    expect(scheduler.snapshot()).toMatchObject({activeCount: 0, queuedCount: 0})
  })

  test("aborts queued work without admission and records cancellation", async () => {
    const scheduler = new StorybookBuildScheduler({limit: 1})
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolvePromise) => { releaseFirst = resolvePromise })
    const first = scheduler.run(request("first"), () => firstGate, new AbortController().signal)
    const controller = new AbortController()
    let started = false
    const queued = scheduler.run(request("queued"), async () => { started = true }, controller.signal)
    await Bun.sleep(0)
    controller.abort(new DOMException("detached", "AbortError"))
    await expect(queued).rejects.toThrow("detached")
    expect(started).toBeFalse()
    expect(scheduler.snapshot().recent[0]).toMatchObject({
      operationId: "queued",
      outcome: "canceled",
      startedAt: null,
      executionDurationMs: 0,
    })
    releaseFirst()
    await first
  })

  test("keeps a canceled running operation active until its exact lifecycle settles", async () => {
    const scheduler = new StorybookBuildScheduler({limit: 1})
    const transitions: Readonly<{state: string, outcome?: string}>[] = []
    scheduler.subscribe((transition) => transitions.push(transition))
    const controller = new AbortController()
    let started!: () => void
    const startedGate = new Promise<void>((resolvePromise) => { started = resolvePromise })
    const running = scheduler.run(request("running"), async ({signal}) => {
      started()
      await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), {once: true}))
    }, controller.signal)
    await startedGate
    controller.abort(new DOMException("superseded", "AbortError"))
    expect(scheduler.snapshot().active[0]).toMatchObject({operationId: "running", state: "canceling"})
    await expect(running).rejects.toThrow("superseded")
    expect(scheduler.snapshot()).toMatchObject({activeCount: 0, queuedCount: 0})
    expect(scheduler.snapshot().recent[0]).toMatchObject({operationId: "running", outcome: "canceled"})
    expect(transitions.slice(-2)).toMatchObject([
      {state: "canceling"},
      {state: "completed", outcome: "canceled"},
    ])
  })

  test("distinguishes timeout and bounds recent completion history", async () => {
    const scheduler = new StorybookBuildScheduler({limit: 1, recentLimit: 2})
    for (const id of ["one", "two"]) {
      await scheduler.run(request(id), async () => {}, new AbortController().signal)
    }
    const controller = new AbortController()
    const timedOut = scheduler.run(request("timeout"), async ({signal}) => {
      controller.abort(new DOMException("budget exhausted", "TimeoutError"))
      signal.throwIfAborted()
    }, controller.signal)
    await expect(timedOut).rejects.toThrow("budget exhausted")
    expect(scheduler.snapshot().recent.map(({operationId, outcome}) => [operationId, outcome])).toEqual([
      ["timeout", "timed-out"],
      ["two", "completed"],
    ])
  })

  test("samples bound worker trees only on throttled status reads without exposing PID", async () => {
    let samples = 0
    let now = Date.parse("2026-09-11T08:00:00.000Z")
    const rows = parseStorybookProcessResourceRows([
      " 100 1 12.5 2048 Thu Sep 11 08:00:00 2026",
      " 101 100 3.25 512 Thu Sep 11 08:00:01 2026",
    ].join("\n"))
    const scheduler = new StorybookBuildScheduler({
      limit: 1,
      now: () => now,
      resourceSampler: {sample: () => {
        samples += 1
        return rows
      }},
    })
    let release!: () => void
    const gate = new Promise<void>((resolvePromise) => { release = resolvePromise })
    const running = scheduler.run(request("measured"), async ({bindWorker}) => {
      bindWorker({pid: 100, startedAt: "2026-09-11T08:00:00.000Z"})
      await gate
    }, new AbortController().signal)
    await Bun.sleep(0)
    const first = scheduler.snapshot({sampleResources: true})
    expect(first.active[0]?.resources).toMatchObject({
      cpuPercent: 15.75,
      rssBytes: 2_621_440,
      descendantCount: 1,
      peakCpuPercent: 15.75,
      peakRssBytes: 2_621_440,
    })
    expect(JSON.stringify(first)).not.toContain('"pid"')
    scheduler.snapshot({sampleResources: true})
    expect(samples).toBe(1)
    now += 1_000
    scheduler.snapshot({sampleResources: true})
    expect(samples).toBe(2)
    release()
    await running
    now += 1_000
    scheduler.snapshot({sampleResources: true})
    expect(samples).toBe(2)
  })
})
