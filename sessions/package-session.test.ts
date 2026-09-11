import {afterEach, describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {STORYBOOK_PACKAGE_GRAPH_PROTOCOL, type StorybookPackageRevisionGraphSnapshot} from "./package-revision.ts"
import {
  parseStorybookBuildInputFingerprint,
  sameStorybookBuildInputFingerprint,
  STORYBOOK_BUILD_INPUT_FINGERPRINT_PROTOCOL,
  type StorybookBuildInputFingerprint,
} from "../build/build-input-fingerprint.ts"
import {StorybookBuildScheduler} from "../build/build-scheduler.ts"
import {parseStorybookProcessResourceRows} from "../build/resource-usage.ts"
import {
  StorybookPackageSession,
  storybookBuildError,
  storybookDiagnostic,
  type StorybookPackageBuildDescriptor,
  type StorybookPackageEvent,
  type StorybookPackageRevisionBuilder,
  type StorybookPackageInputFingerprintVerifier,
} from "./package-session.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("working Storybook PackageSession lifecycle", () => {
  test("общая зависимость готовится до занятия единственного slot пакетом", async () => {
    const root = fixtureRoot("shared-before-admission")
    const scheduler = new StorybookBuildScheduler(1)
    const order: string[] = []
    const session = new StorybookPackageSession(descriptor(root, "@fixture/a"), {
      artifactRoot: join(root, ".artifacts"),
      buildScheduler: scheduler,
      prepareBuild: async signal => {
        await scheduler.run({packageId: null, owner: "shared", reason: "missing", generation: null}, async () => {
          order.push("shared")
        }, signal)
      },
      buildRevision: async input => {
        order.push("package")
        return successfulBuild(input.stagingDirectory)
      },
    })
    try {
      expect((await session.ensureBuilt()).buildState).toBe("built")
      expect(order).toEqual(["shared", "package"])
    } finally {
      await session.dispose()
      await scheduler.dispose()
    }
  }, 2000)

  test("tracks candidate dependencies while a different revision remains active", async () => {
    const root = fixtureRoot("candidate-dependencies")
    const firstPath = join(root, "first.ts")
    const nextPath = join(root, "next.ts")
    writeFileSync(firstPath, "first")
    writeFileSync(nextPath, "next")
    let dependency = firstPath
    const session = createSession(descriptor(root, "@fixture/a"), async input => ({
      ...successfulBuild(input.stagingDirectory),
      dependencyRealpaths: [dependency],
    }), [])
    const first = await session.ensureBuilt()
    const activation = session.beginActivation({revision: first.builtRevision!, viewId: "view-a", route: "category/subject/default"})
    session.acknowledgeActivation({...activation, frameSequence: 1})
    dependency = nextPath
    session.reconfigure(descriptor(root, "@fixture/a", "two"))
    const next = await session.ensureBuilt()
    expect(next.activeRevision).toBe(first.builtRevision!)
    expect(next.dependencyRealpaths).toEqual(expect.arrayContaining([realpathSync(firstPath), realpathSync(nextPath)]))
    expect(session.invalidate(nextPath)).toBe(true)
    await session.dispose()
  })

  test("keeps a successful build merely built until exact agent application", async () => {
    const root = fixtureRoot("activation")
    const events: StorybookPackageEvent[] = []
    const session = createSession(descriptor(root, "@fixture/a"), successfulBuilder(), events)
    const built = await session.ensureBuilt()
    expect(built.buildState).toBe("built")
    expect(built.builtRevision).not.toBeNull()
    expect(built.activeRevision).toBeNull()
    expect(built.lastWorkingRevision).toBeNull()

    const activation = session.beginActivation({
      revision: built.builtRevision!,
      viewId: "view-a",
      route: "category/subject/default",
    })
    expect(() => session.acknowledgeActivation({
      ...activation,
      packageGraphDigest: "foreign-graph",
      frameSequence: 7,
    })).toThrow("does not match its lease")
    expect(session.snapshot().activeRevision).toBeNull()
    const working = session.acknowledgeActivation({
      ...activation,
      frameSequence: 7,
    })
    expect(working.buildState).toBe("active")
    expect(working.activeRevision).toBe(built.builtRevision!)
    expect(working.lastWorkingRevision).toBe(built.builtRevision!)
    expect(working.lastGoodRevision).toBe(built.builtRevision!)
    expect(events.map(({type}) => type)).toEqual([
      "package.built",
      "package.activating",
      "package.updated",
    ])
  })

  test("activation failure preserves previous active and lastWorking revision", async () => {
    const root = fixtureRoot("activation-failure")
    const events: StorybookPackageEvent[] = []
    const session = createSession(descriptor(root, "@fixture/a", "one"), successfulBuilder(), events)
    const first = await session.ensureBuilt()
    const firstActivation = session.beginActivation({
      revision: first.builtRevision!, viewId: "view-a", route: "category/subject/default",
    })
    const working = session.acknowledgeActivation({...firstActivation, frameSequence: 1})

    session.reconfigure(descriptor(root, "@fixture/a", "two"))
    const second = await session.ensureBuilt()
    const secondActivation = session.beginActivation({
      revision: second.builtRevision!, viewId: "view-a", route: "category/subject/default",
    })
    const failed = session.failActivation({
      revision: secondActivation.revision,
      activationId: secondActivation.activationId,
      diagnostic: storybookDiagnostic("activation", "runtime.create failed"),
    })
    expect(failed.buildState).toBe("failed")
    expect(failed.activeRevision).toBe(working.activeRevision)
    expect(failed.lastWorkingRevision).toBe(working.lastWorkingRevision)
    expect(failed.failedRevision).toBe(secondActivation.revision)
    expect(failed.diagnostics[0]?.message).toBe("runtime.create failed")
  })

  test("restarts the exact activation lease on a repeated agent verification", async () => {
    const root = fixtureRoot("activation-restart")
    const session = createSession(descriptor(root, "@fixture/a"), successfulBuilder(), [])
    const built = await session.ensureBuilt()
    const first = session.beginActivation({
      revision: built.builtRevision!, viewId: "view-first", route: "category/subject/default",
    })
    const second = session.beginActivation({
      revision: built.builtRevision!, viewId: "view-second", route: "category/subject/default",
    })
    expect(second.activationId).not.toBe(first.activationId)
    expect(() => session.acknowledgeActivation({...first, frameSequence: 1})).toThrow("stale")
    const working = session.acknowledgeActivation({...second, frameSequence: 1})
    expect(working.activeRevision).toBe(built.builtRevision!)
    expect(working.lastWorkingRevision).toBe(built.builtRevision!)
  })

  test("compile failure preserves working revision and package-local diagnostics", async () => {
    const root = fixtureRoot("compile-failure")
    let fail = false
    const session = createSession(descriptor(root, "@fixture/a"), async (input) => {
      if (fail) throw storybookBuildError(storybookDiagnostic("compile", "Unexpected token", input.descriptor.runtime!.path))
      return successfulBuild(input.stagingDirectory)
    }, [])
    const first = await session.ensureBuilt()
    const activation = session.beginActivation({
      revision: first.builtRevision!, viewId: "view-a", route: "category/subject/default",
    })
    const working = session.acknowledgeActivation({...activation, frameSequence: 1})
    fail = true
    session.reconfigure(descriptor(root, "@fixture/a", "broken"))
    const failed = await session.ensureBuilt()
    expect(failed.buildState).toBe("failed")
    expect(failed.activeRevision).toBe(working.activeRevision)
    expect(failed.lastWorkingRevision).toBe(working.lastWorkingRevision)
    expect(failed.diagnostics[0]?.message).toBe("Unexpected token")
    fail = false
    expect(session.retryFailed()).toBeTrue()
    const retried = await session.ensureBuilt()
    expect(retried.buildState).toBe("built")
    expect(retried.builtRevision).not.toBe(failed.failedRevision)
    expect(retried.diagnostics).toEqual([])
    expect(session.retryFailed()).toBeFalse()
  })

  test("coalesces one active generation and cancels its superseded build before building latest", async () => {
    const root = fixtureRoot("queue")
    let calls = 0
    let firstStarted!: () => void
    const started = new Promise<void>((resolvePromise) => { firstStarted = resolvePromise })
    const session = createSession(descriptor(root, "@fixture/a", "one"), async (input) => {
      calls += 1
      if (calls === 1) {
        firstStarted()
        await new Promise<void>((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(input.signal.reason), {once: true})
        })
      }
      return successfulBuild(input.stagingDirectory)
    }, [])
    const unsubscribe = session.subscribe()
    const first = session.ensureBuilt()
    const duplicate = session.ensureBuilt()
    await started
    session.reconfigure(descriptor(root, "@fixture/a", "two"))
    const latest = session.ensureBuilt()
    await Promise.all([first, duplicate, latest])
    expect(calls).toBe(2)
    expect(session.snapshot().generation).toBe(2)
    expect(session.snapshot().buildState).toBe("built")
    expect(session.snapshot().revisions?.at(-1)?.declarationDigest).toBe("digest-two")
    unsubscribe()
  })

  test("keeps inactive reconfigure stale until the first subscriber requests its latest generation", async () => {
    const root = fixtureRoot("inactive-reconfigure")
    const builtDigests: string[] = []
    const session = createSession(descriptor(root, "@fixture/a", "one"), async (input) => {
      builtDigests.push(input.descriptor.declarationDigest)
      return successfulBuild(input.stagingDirectory)
    }, [])
    await session.ensureBuilt()

    session.reconfigure(descriptor(root, "@fixture/a", "two"))
    await Bun.sleep(20)
    expect(session.snapshot()).toMatchObject({
      subscribers: 0,
      generation: 2,
      builds: 1,
    })
    expect(builtDigests).toEqual(["digest-one"])

    const unsubscribe = session.subscribe()
    await waitFor(() => session.snapshot().builds === 2 && session.snapshot().buildState === "built")
    expect(builtDigests).toEqual(["digest-one", "digest-two"])
    expect(session.snapshot().revisions?.at(-1)?.generation).toBe(2)
    unsubscribe()
  })

  test("does not restart a failed package while it has no subscribers", async () => {
    const root = fixtureRoot("inactive-failure")
    const session = createSession(descriptor(root, "@fixture/a", "one"), async (input) => {
      throw storybookBuildError(storybookDiagnostic("compile", "broken fixture", input.descriptor.runtime!.path))
    }, [])
    await session.ensureBuilt()
    expect(session.snapshot()).toMatchObject({subscribers: 0, builds: 1, buildState: "failed"})

    session.reconfigure(descriptor(root, "@fixture/a", "two"))
    await Bun.sleep(20)
    expect(session.snapshot()).toMatchObject({subscribers: 0, generation: 2, builds: 1})

    expect(session.invalidate(session.descriptor.variants[0]!.module.path)).toBeTrue()
    await Bun.sleep(20)
    expect(session.snapshot()).toMatchObject({subscribers: 0, generation: 3, builds: 1})
  })

  test("recovers a subscribed package after the next invalidation fixes its failed generation", async () => {
    const root = fixtureRoot("active-failure-recovery")
    let fail = false
    const session = createSession(descriptor(root, "@fixture/a"), async (input) => {
      if (fail) {
        throw storybookBuildError(storybookDiagnostic("compile", "broken fixture", input.descriptor.runtime!.path))
      }
      return successfulBuild(input.stagingDirectory)
    }, [])
    const unsubscribe = session.subscribe()
    await waitFor(() => session.snapshot().buildState === "built")
    const source = session.descriptor.variants[0]!.module.path

    fail = true
    expect(session.invalidate(source)).toBeTrue()
    await waitFor(() => session.snapshot().buildState === "failed")
    fail = false
    expect(session.invalidate(source)).toBeTrue()
    await waitFor(() => session.snapshot().buildState === "built" && session.snapshot().builds === 3)
    expect(session.snapshot().diagnostics).toEqual([])
    unsubscribe()
  })

  test("keeps inactive invalidation stale and cancels its pending rebuild when the last subscriber leaves", async () => {
    const root = fixtureRoot("inactive-invalidation")
    const session = createSession(
      descriptor(root, "@fixture/a"),
      successfulBuilder(),
      [],
      {rebuildDelayMs: 40},
    )
    const unsubscribeFirst = session.subscribe()
    await waitFor(() => session.snapshot().builds === 1 && session.snapshot().buildState === "built")
    const source = session.descriptor.variants[0]!.module.path

    expect(session.invalidate(source)).toBeTrue()
    unsubscribeFirst()
    await Bun.sleep(80)
    expect(session.snapshot()).toMatchObject({subscribers: 0, generation: 2, builds: 1})

    expect(session.invalidate(source)).toBeTrue()
    await Bun.sleep(80)
    expect(session.snapshot()).toMatchObject({subscribers: 0, generation: 3, builds: 1})

    const unsubscribeLatest = session.subscribe()
    await waitFor(() => session.snapshot().builds === 2 && session.snapshot().buildState === "built")
    expect(session.snapshot().revisions?.at(-1)?.generation).toBe(3)
    unsubscribeLatest()
  })

  test("does not cancel an already running build when its last subscriber leaves", async () => {
    const root = fixtureRoot("inactive-running-subscriber")
    let releaseBuild!: () => void
    let markStarted!: () => void
    let aborted = false
    const started = new Promise<void>((resolvePromise) => { markStarted = resolvePromise })
    const released = new Promise<void>((resolvePromise) => { releaseBuild = resolvePromise })
    const session = createSession(descriptor(root, "@fixture/a"), async (input) => {
      input.signal.addEventListener("abort", () => { aborted = true }, {once: true})
      markStarted()
      await released
      return successfulBuild(input.stagingDirectory)
    }, [])

    const unsubscribe = session.subscribe()
    await started
    unsubscribe()
    expect(session.snapshot().subscribers).toBe(0)
    expect(aborted).toBeFalse()
    releaseBuild()
    await waitFor(() => session.snapshot().buildState === "built")
    expect(aborted).toBeFalse()
    expect(session.snapshot().builds).toBe(1)
  })

  test("does not cancel an inactive running build and lets explicit ensure reach the latest generation", async () => {
    const root = fixtureRoot("inactive-running")
    let releaseBuild!: () => void
    let markStarted!: () => void
    let aborted = false
    const started = new Promise<void>((resolvePromise) => { markStarted = resolvePromise })
    const released = new Promise<void>((resolvePromise) => { releaseBuild = resolvePromise })
    const builtDigests: string[] = []
    const session = createSession(descriptor(root, "@fixture/a", "one"), async (input) => {
      builtDigests.push(input.descriptor.declarationDigest)
      input.signal.addEventListener("abort", () => { aborted = true }, {once: true})
      markStarted()
      await released
      return successfulBuild(input.stagingDirectory)
    }, [])

    const initial = session.ensureBuilt()
    await started
    session.reconfigure(descriptor(root, "@fixture/a", "two"))
    expect(aborted).toBeFalse()
    releaseBuild()
    await initial
    expect(aborted).toBeFalse()
    expect(builtDigests).toEqual(["digest-one", "digest-two"])
    expect(session.snapshot()).toMatchObject({
      subscribers: 0,
      generation: 2,
      builds: 2,
      buildState: "built",
    })
    expect(session.snapshot().revisions?.at(-1)?.generation).toBe(2)
  })

  test("detach aborts exact build and dispose is idempotent", async () => {
    const root = fixtureRoot("dispose")
    let aborted = false
    let started!: () => void
    const gate = new Promise<void>((resolvePromise) => { started = resolvePromise })
    const session = createSession(descriptor(root, "@fixture/a"), async (input) => {
      started()
      await new Promise<void>((_resolve, reject) => input.signal.addEventListener("abort", () => {
        aborted = true
        reject(input.signal.reason)
      }, {once: true}))
      return successfulBuild(input.stagingDirectory)
    }, [])
    void session.ensureBuilt()
    await gate
    const first = session.dispose()
    const second = session.dispose()
    expect(first).toBe(second)
    await first
    expect(aborted).toBeTrue()
    expect(session.snapshot().buildState).toBe("disposed")
  })

  test("collects released history but preserves the applied revision across disposal", async () => {
    const root = fixtureRoot("retention")
    const session = createSession(
      descriptor(root, "@fixture/a", "one"),
      successfulBuilder(),
      [],
      {retainedRevisionLimit: 0},
    )
    const first = await session.ensureBuilt()
    const firstActivation = session.beginActivation({
      revision: first.builtRevision!, viewId: "view-a", route: "category/subject/default",
    })
    const firstWorking = session.acknowledgeActivation({...firstActivation, frameSequence: 1})
    const oldRevision = firstWorking.activeRevision!
    const lease = session.acquireRevisionLease(oldRevision, "view-lease")

    session.reconfigure(descriptor(root, "@fixture/a", "two"))
    const second = await session.ensureBuilt()
    const secondActivation = session.beginActivation({
      revision: second.builtRevision!, viewId: "view-a", route: "category/subject/default",
    })
    session.acknowledgeActivation({...secondActivation, frameSequence: 2})
    expect(session.revisionDirectory(oldRevision)).not.toBeNull()
    lease.release()
    expect(session.revisionDirectory(oldRevision)).toBeNull()
    const activeRevision = session.snapshot().activeRevision!
    const activeLease = session.acquireRevisionLease(activeRevision, "active-view")
    await session.dispose()
    expect(session.revisionDirectory(activeRevision)).not.toBeNull()
    activeLease.release()
    expect(session.revisionDirectory(activeRevision)).not.toBeNull()
    const restored = createSession(descriptor(root, "@fixture/a", "two"), successfulBuilder(), [])
    expect(restored.snapshot().activeRevision).toBe(activeRevision)
    expect(restored.snapshot().builds).toBe(0)
    expect(restored.snapshot()).toMatchObject({
      generation: 1,
      completedGeneration: 0,
      inputFreshness: "unverified",
    })
    const refreshed = await restored.ensureBuilt()
    expect(refreshed).toMatchObject({
      activeRevision,
      builds: 1,
      buildState: "built",
      inputFreshness: "unverified",
    })
    expect(refreshed.builtRevision).not.toBe(activeRevision)
    await restored.dispose()
  })

  test("restores an exact v2 receipt at the current generation without a new build", async () => {
    const root = fixtureRoot("receipt-v2-hit")
    const value = descriptor(root, "@fixture/a")
    const fingerprint = fakeInputFingerprint(root, value.declarationDigest)
    let builds = 0
    const builder: StorybookPackageRevisionBuilder = async ({stagingDirectory}) => {
      builds += 1
      return {...successfulBuild(stagingDirectory), inputFingerprint: fingerprint}
    }
    const first = createSession(value, builder, [])
    const built = await first.ensureBuilt()
    const activation = first.beginActivation({
      revision: built.builtRevision!, viewId: "view-a", route: "category/subject/default",
    })
    first.acknowledgeActivation({...activation, frameSequence: 1})
    await first.dispose()

    const verifier: StorybookPackageInputFingerprintVerifier = (persisted, descriptor) =>
      descriptor.declarationDigest === value.declarationDigest
        ? parseStorybookBuildInputFingerprint(persisted)
        : null
    const restored = createSession(value, builder, [], {verifyInputFingerprint: verifier})
    expect(restored.snapshot()).toMatchObject({
      activeRevision: built.builtRevision,
      generation: 1,
      requestedGeneration: 0,
      completedGeneration: 1,
      builds: 0,
      inputFreshness: "verified",
      cacheOutcome: {status: "hit", layer: "receipt"},
    })
    expect(restored.inputWatchPaths()).toContain(realpathSync(root))
    expect(restored.revalidateInputs()).toBeFalse()
    const unsubscribe = restored.subscribe()
    await restored.ensureBuilt()
    expect(restored.snapshot().builds).toBe(0)
    expect(builds).toBe(1)
    unsubscribe()
    expect(restored.invalidate(root)).toBeTrue()
    expect(restored.snapshot()).toMatchObject({
      inputFreshness: "changed",
      cacheOutcome: null,
      generation: 2,
      completedGeneration: 1,
      builds: 0,
    })
    await restored.dispose()
  })

  test("explicit revalidation detects a fingerprint change before the watcher tick", async () => {
    const root = fixtureRoot("receipt-v2-explicit-revalidation")
    const value = descriptor(root, "@fixture/a")
    const config = join(root, "tsconfig.json")
    const ambient = join(root, "global.d.ts")
    writeFileSync(config, "{\"compilerOptions\":{}}\n")
    writeFileSync(ambient, "declare const fixture: true\n")
    const currentFingerprint = (): StorybookBuildInputFingerprint => fakeInputFingerprint(
      root,
      value.declarationDigest,
      `${readFileSync(config, "utf8")}\0${readFileSync(ambient, "utf8")}`,
    )
    let builds = 0
    const builder: StorybookPackageRevisionBuilder = async ({stagingDirectory}) => {
      builds += 1
      return {...successfulBuild(stagingDirectory), inputFingerprint: currentFingerprint()}
    }
    const first = createSession(value, builder, [])
    const built = await first.ensureBuilt()
    const activation = first.beginActivation({
      revision: built.builtRevision!, viewId: "view-a", route: "category/subject/default",
    })
    first.acknowledgeActivation({...activation, frameSequence: 1})
    await first.dispose()

    const restored = createSession(value, builder, [], {
      verifyInputFingerprint: (persisted) => {
        const current = currentFingerprint()
        return sameStorybookBuildInputFingerprint(persisted, current) ? current : null
      },
    })
    expect(restored.revalidateInputs()).toBeFalse()
    await restored.ensureBuilt({owner: "check"})
    expect(restored.snapshot().builds).toBe(0)
    expect(builds).toBe(1)

    writeFileSync(config, "{\"compilerOptions\":{\"strict\":true}}\n")
    writeFileSync(ambient, "declare const fixture: false\n")
    expect(restored.revalidateInputs()).toBeTrue()
    expect(restored.snapshot()).toMatchObject({
      generation: 2,
      completedGeneration: 1,
      inputFreshness: "changed",
      cacheOutcome: null,
      builds: 0,
    })
    const refreshed = await restored.ensureBuilt({owner: "check"})
    expect(refreshed).toMatchObject({
      activeRevision: built.builtRevision,
      generation: 2,
      builds: 1,
      buildState: "built",
      inputFreshness: "verified",
    })
    expect(builds).toBe(2)
    await restored.dispose()
  })

  test("keeps a mismatched v2 receipt as fallback and builds the current generation", async () => {
    const root = fixtureRoot("receipt-v2-miss")
    const value = descriptor(root, "@fixture/a")
    const fingerprint = fakeInputFingerprint(root, value.declarationDigest)
    const first = createSession(value, async ({stagingDirectory}) => ({
      ...successfulBuild(stagingDirectory),
      inputFingerprint: fingerprint,
    }), [])
    const built = await first.ensureBuilt()
    const activation = first.beginActivation({
      revision: built.builtRevision!, viewId: "view-a", route: "category/subject/default",
    })
    first.acknowledgeActivation({...activation, frameSequence: 1})
    await first.dispose()

    let freshBuilds = 0
    const restored = createSession(value, async ({stagingDirectory}) => {
      freshBuilds += 1
      return successfulBuild(stagingDirectory)
    }, [], {verifyInputFingerprint: () => null})
    expect(restored.snapshot()).toMatchObject({
      activeRevision: built.builtRevision,
      generation: 1,
      completedGeneration: 0,
      builds: 0,
      inputFreshness: "unverified",
    })
    const fresh = await restored.ensureBuilt()
    expect(fresh).toMatchObject({
      activeRevision: built.builtRevision,
      buildState: "built",
      builds: 1,
      inputFreshness: "unverified",
    })
    expect(fresh.builtRevision).not.toBe(built.builtRevision)
    expect(freshBuilds).toBe(1)
    await restored.dispose()
  })

  test("binds exact per-operation phase and worker lifecycle to scheduler resources", async () => {
    const root = fixtureRoot("scheduler-hooks")
    const rows = parseStorybookProcessResourceRows([
      " 100 1 9.5 1024 Thu Sep 11 08:00:00 2026",
      " 101 100 2.5 256 Thu Sep 11 08:00:01 2026",
    ].join("\n"))
    const scheduler = new StorybookBuildScheduler({
      limit: 1,
      resourceSampler: {sample: () => rows},
    })
    let release!: () => void
    let markStarted!: () => void
    const gate = new Promise<void>((resolvePromise) => { release = resolvePromise })
    const started = new Promise<void>((resolvePromise) => { markStarted = resolvePromise })
    const session = createSession(descriptor(root, "@fixture/a"), async (input) => {
      const at = new Date().toISOString()
      input.onWorkerLifecycle?.({state: "started", workerId: "exact-worker-id-1", pid: 100, startedAt: at})
      input.onPhase?.({phase: "exports", state: "started", at})
      markStarted()
      await gate
      input.onPhase?.({phase: "exports", state: "completed", at: new Date().toISOString()})
      input.onWorkerLifecycle?.({
        state: "exited",
        workerId: "exact-worker-id-1",
        pid: 100,
        startedAt: at,
        finishedAt: new Date().toISOString(),
        exitCode: 0,
      })
      return successfulBuild(input.stagingDirectory)
    }, [], {buildScheduler: scheduler})
    const pending = session.ensureBuilt({owner: "open"})
    await started
    const snapshot = scheduler.snapshot({sampleResources: true})
    expect(snapshot.active[0]).toMatchObject({
      packageId: "@fixture/a",
      owner: "open",
      phase: "exports",
      resources: {cpuPercent: 12, rssBytes: 1_310_720, descendantCount: 1},
    })
    expect(JSON.stringify(snapshot)).not.toContain('"pid"')
    release()
    await pending
    expect(scheduler.snapshot().recent[0]).toMatchObject({outcome: "completed", phase: "publish"})
    await session.dispose()
  })

  test("requires exact resources for separate Workbench and active author sheet collections", async () => {
    const root = fixtureRoot("workbench-author-sheets")
    const base = descriptor(root, "@fixture/a")
    const theme = join(root, "theme.css")
    writeFileSync(theme, ":root { --theme: 1; }\n")
    const contentDigest = createHash("sha256").update(":root { --theme: 1; }\n").digest("hex")
    const graphSnapshot = redigest({
      ...base.graphSnapshot,
      workbenchAuthorStyleSheets: [{
        specifier: "@zavx0z/ui/themes/theme.css",
        url: "workbench-author-style-sheets/0.css",
        contentDigest,
      }],
    })
    const good = {
      ...base,
      graphSnapshot,
      resourceFiles: [{
        sourcePath: theme,
        sourceRoot: root,
        targetPath: "workbench-author-style-sheets/0.css",
        contentDigest,
      }],
    }
    const session = createSession(good, successfulBuilder(), [])
    await session.dispose()
    expect(() => createSession({...good, resourceFiles: []}, successfulBuilder(), []))
      .toThrow("resource does not match graph snapshot")
  })
})

function createSession(
  value: StorybookPackageBuildDescriptor,
  buildRevision: StorybookPackageRevisionBuilder,
  events: StorybookPackageEvent[],
  overrides: Readonly<{
    retainedRevisionLimit?: number
    rebuildDelayMs?: number
    verifyInputFingerprint?: StorybookPackageInputFingerprintVerifier
    buildScheduler?: StorybookBuildScheduler
  }> = {},
): StorybookPackageSession {
  return new StorybookPackageSession(value, {
    artifactRoot: join(value.projectRoot, ".artifacts"),
    buildRevision,
    rebuildDelayMs: 0,
    publish: (event) => events.push(event),
    ...overrides,
  })
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Storybook package session state")
    await Bun.sleep(5)
  }
}

function descriptor(root: string, packageId: string, version = "one"): StorybookPackageBuildDescriptor {
  const runtime = join(root, "runtime.ts")
  const story = join(root, "story.ts")
  const manifest = join(root, "manifest.json")
  writeFileSync(runtime, "export const runtime = {}\n")
  writeFileSync(story, "export const story = {}\n")
  writeFileSync(manifest, "{}\n")
  const declarationDigest = `digest-${version}`
  return {
    packageId,
    packageRoot: root,
    projectRoot: root,
    sourcePath: manifest,
    declarationDigest,
    graphSnapshot: graphSnapshot(packageId, declarationDigest),
    runtime: {path: runtime, export: "runtime"},
    variants: [{route: "category/subject/default", module: {path: story, export: "story"}}],
    widgetModules: [],
  }
}

function graphSnapshot(packageId: string, declarationDigest: string): StorybookPackageRevisionGraphSnapshot {
  const packageNodeId = `package:${packageId}`
  const subjectNodeId = `subject:${packageId}/category/subject`
  const variantNodeId = `variant:${packageId}/category/subject/default`
  const presentation = {
    protocol: "story-presentation/1" as const,
    projection: "display" as const,
    widgets: ["source", "diagnostics"],
  }
  const withoutDigest = {
    protocol: STORYBOOK_PACKAGE_GRAPH_PROTOCOL,
    packageId,
    declarationDigest,
    metadata: {label: packageId, ownerId: packageId, urlPath: `/packages/${encodeURIComponent(packageId)}/`},
    ancestors: [],
    rootId: packageNodeId,
    nodes: [
      {
        id: packageNodeId, kind: "package" as const, ownerId: packageId, packageId, label: packageId,
        parentId: null, childIds: [subjectNodeId], urlPath: `/packages/${encodeURIComponent(packageId)}/`, routePath: "",
        searchTerms: [packageId], group: null, subjectKind: null, apiName: null, hasReadme: false,
        resourceKinds: [], resourceUrl: `/__storybook/resources/nodes/${encodeURIComponent(packageNodeId)}/`,
        presentation: null,
      },
      {
        id: subjectNodeId, kind: "subject" as const, ownerId: packageId, packageId, label: "Subject",
        parentId: packageNodeId, childIds: [variantNodeId],
        urlPath: `/packages/${encodeURIComponent(packageId)}/category/subject/`, routePath: "category/subject",
        searchTerms: ["subject"], group: null, subjectKind: "fixture", apiName: null, hasReadme: false,
        resourceKinds: [], resourceUrl: `/__storybook/resources/nodes/${encodeURIComponent(subjectNodeId)}/`,
        presentation,
      },
      {
        id: variantNodeId, kind: "variant" as const, ownerId: packageId, packageId, label: "Default",
        parentId: subjectNodeId, childIds: [],
        urlPath: `/packages/${encodeURIComponent(packageId)}/category/subject/default`,
        routePath: "category/subject/default", searchTerms: ["default"], group: null, subjectKind: null,
        apiName: null, hasReadme: false, resourceKinds: [],
        resourceUrl: `/__storybook/resources/nodes/${encodeURIComponent(variantNodeId)}/`,
        presentation,
      },
    ],
    routes: [
      {path: "", urlPath: `/packages/${encodeURIComponent(packageId)}/`, kind: "overview" as const, nodeId: packageNodeId},
      {
        path: "category/subject", urlPath: `/packages/${encodeURIComponent(packageId)}/category/subject/`,
        kind: "overview" as const, nodeId: subjectNodeId,
      },
      {
        path: "category/subject/default",
        urlPath: `/packages/${encodeURIComponent(packageId)}/category/subject/default`,
        kind: "variant" as const,
        nodeId: variantNodeId,
      },
    ],
    loaders: [{route: "category/subject/default", nodeId: variantNodeId, exportName: "story"}],
    resources: [],
    authorStyleSheets: [],
    workbenchAuthorStyleSheets: [],
    widgetContributions: null,
    widgetLoaders: [],
  }
  return Object.freeze({
    ...withoutDigest,
    packageGraphDigest: createHash("sha256").update(JSON.stringify(withoutDigest)).digest("hex"),
  })
}

function redigest(
  value: StorybookPackageRevisionGraphSnapshot,
): StorybookPackageRevisionGraphSnapshot {
  const {packageGraphDigest: _previous, ...withoutDigest} = value
  return Object.freeze({
    ...withoutDigest,
    packageGraphDigest: createHash("sha256").update(JSON.stringify(withoutDigest)).digest("hex"),
  })
}

function successfulBuilder(): StorybookPackageRevisionBuilder {
  return async ({stagingDirectory}) => successfulBuild(stagingDirectory)
}

function successfulBuild(stagingDirectory: string) {
  mkdirSync(stagingDirectory, {recursive: true})
  writeFileSync(join(stagingDirectory, "entry.js"), "export {}\n")
  return {moduleGraphRevision: "module-graph-revision", dependencyRealpaths: [], entryRelativePath: "entry.js"}
}

function fakeInputFingerprint(
  root: string,
  descriptorDigest: string,
  inputToken = "stable",
): StorybookBuildInputFingerprint {
  const digest = (label: string): string => createHash("sha256").update(label).digest("hex")
  const categories = {
    descriptorDigest: digest(`descriptor:${descriptorDigest}`),
    protocol: STORYBOOK_BUILD_INPUT_FINGERPRINT_PROTOCOL,
    sourceDigest: digest(`source:${descriptorDigest}:${inputToken}`),
    toolchainDigest: digest("toolchain"),
    validationDigest: digest("validation"),
  } as const
  return Object.freeze({
    ...categories,
    digest: createHash("sha256").update(JSON.stringify(categories)).digest("hex"),
    roots: Object.freeze([realpathSync(root)]),
    resolutionDirectories: Object.freeze([]),
    watchDirectories: Object.freeze([realpathSync(root)]),
    files: Object.freeze([]),
  })
}

function fixtureRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `storybook-session-${name}-`))
  roots.push(root)
  return root
}
