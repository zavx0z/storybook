import PackageBuildSchedulerOwner, {type StorybookPackageBuildScheduler as PackageBuildSchedulerContract} from "@storybook-package-build/scheduler"
const StorybookBuildScheduler = PackageBuildSchedulerOwner
type StorybookBuildScheduler = PackageBuildSchedulerContract.Output
import {afterEach, describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import Revision, {type StorybookPackageRevision} from "@storybook-package/revision"
import type {StorybookTechProcessSample} from "@storybook-tech-process/sample"
import StorybookPackageSession, {type StorybookPackageSession as Contract} from "@storybook-package/session"

type StorybookPackageBuildDescriptor = Contract.Input[0]
type StorybookPackageRevisionBuilder = Contract.Input[1]["buildRevision"]
type StorybookPackageEvent = Parameters<NonNullable<Contract.Input[1]["publish"]>>[0]
type StorybookPackageRevisionGraphSnapshot = ReturnType<StorybookPackageRevision.Output["create"]>

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("working Storybook StorybookPackageSession lifecycle", () => {
  test("платформа потребителя сохраняется вместе с применённой ревизией", async () => {
    const root = fixtureRoot("kernel-receipt")
    const value = descriptor(root, "@fixture/kernel")
    const epoch = "a".repeat(64)
    const builder: StorybookPackageRevisionBuilder = async input => ({...successfulBuild(input.stagingDirectory), sharedModuleEpoch: epoch})
    const session = createSession(value, builder, [])
    const built = await session.ensureBuilt()
    const lease = session.beginActivation({revision: built.builtRevision!, viewId: "view", route: ""})
    session.acknowledgeActivation({...lease, frameSequence: 1})
    await session.dispose()
    const restored = createSession(value, builder, [])
    expect(restored.snapshot().revisions?.find(record => record.revision === built.builtRevision)?.sharedModuleEpoch).toBe(epoch)
    expect(restored.snapshot().builds).toBe(0)
    await restored.dispose()
  })

  test("строгость закрепляется только применением и переживает регрессию и перезапуск", async () => {
    const root = fixtureRoot("standard")
    const modes: (string | undefined)[] = []
    let passed = true
    const builder: StorybookPackageRevisionBuilder = async input => {
      modes.push(input.standard)
      return {...successfulBuild(input.stagingDirectory), verification: {
        status: passed ? "passed" : "incomplete",
        diagnostics: [],
      }}
    }
    const value = descriptor(root, "@fixture/standard")
    const session = createSession(value, builder, [])
    const built = await session.ensureBuilt()
    expect(built.standard).toBe("transition")
    const rejected = session.beginActivation({revision: built.builtRevision!, viewId: "view", route: ""})
    session.failActivation({...rejected, diagnostic: StorybookPackageSession.diagnostic("activation", "кадр не готов")})
    expect(session.snapshot().standard).toBe("transition")
    session.retryFailed()
    const next = await session.build()
    const lease = session.beginActivation({revision: next.builtRevision!, viewId: "view", route: ""})
    session.acknowledgeActivation({...lease, frameSequence: 1})
    expect(session.snapshot().standard).toBe("strict")
    const applied = session.snapshot().activeRevision
    await session.dispose()

    const oldOwner = readdirSync(join(root, ".artifacts"))[0]!
    const oldPath = join(root, ".artifacts", oldOwner, "applied.json")
    const oldReceipt = JSON.parse(readFileSync(oldPath, "utf8"))
    oldReceipt.assessment = {...oldReceipt.verification, classification: "domain"}
    delete oldReceipt.verification
    writeFileSync(oldPath, JSON.stringify(oldReceipt))
    passed = false
    const restored = createSession(value, builder, [])
    expect(restored.snapshot().standard).toBe("strict")
    const failed = await restored.build()
    expect(failed).toMatchObject({standard: "strict", buildState: "failed", activeRevision: applied})
    expect(failed.diagnostics[0]?.message).toContain("полного подтверждения")
    expect(modes).toEqual(["transition", "transition", "strict"])
    await restored.dispose()
    const restarted = createSession(value, builder, [])
    expect(restarted.snapshot().standard).toBe("strict")
    await restarted.dispose()
    const owner = readdirSync(join(root, ".artifacts"))[0]!
    const receiptPath = join(root, ".artifacts", owner, "applied.json")
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"))
    receipt.graphSnapshot.protocol = "retired-graph"
    writeFileSync(receiptPath, JSON.stringify(receipt))
    const retired = createSession(value, builder, [])
    expect(retired.snapshot().standard).toBe("strict")
    expect((await retired.ensureBuilt()).buildState).toBe("failed")
    await retired.dispose()
  })

  test("переходный пакет применяет предупреждения без подтверждения миграции", async () => {
    const root = fixtureRoot("standard-warning")
    const warning = StorybookPackageSession.diagnostic("validate", "Обязательное требование ещё TODO")
    const value = descriptor(root, "@fixture/warning")
    const builder: StorybookPackageRevisionBuilder = async input => ({...successfulBuild(input.stagingDirectory),
      verification: {status: "incomplete", diagnostics: []}, warnings: [warning]})
    const session = createSession(value, builder, [])
    const built = await session.ensureBuilt()
    expect(built).toMatchObject({standard: "transition", warnings: [warning], diagnostics: []})
    const lease = session.beginActivation({revision: built.builtRevision!, viewId: "view", route: ""})
    session.acknowledgeActivation({...lease, frameSequence: 1})
    expect(session.snapshot().standard).toBe("transition")
    await session.dispose()
    const restored = createSession(value, builder, [])
    expect(restored.snapshot()).toMatchObject({standard: "transition", warnings: [warning]})
    await restored.dispose()
  })

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
    const activation = session.beginActivation({revision: first.builtRevision!, viewId: "view-a", route: "dir-module"})
    session.acknowledgeActivation({...activation, frameSequence: 1})
    dependency = nextPath
    session.reconfigure(descriptor(root, "@fixture/a", "two"))
    const next = await session.build()
    expect(next.activeRevision).toBe(first.builtRevision!)
    expect(next.dependencyRealpaths).toEqual(expect.arrayContaining([realpathSync(firstPath), realpathSync(nextPath)]))
    expect(session.reconfigure(descriptor(root, session.packageId, `next-${session.snapshot().generation}`))).toBeTrue()
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
      route: "dir-module",
    })
    expect(activation.deadline, "Применение ждёт подтверждение страницы без общего таймера").toBeNull()
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
      revision: first.builtRevision!, viewId: "view-a", route: "dir-module",
    })
    const working = session.acknowledgeActivation({...firstActivation, frameSequence: 1})

    session.reconfigure(descriptor(root, "@fixture/a", "two"))
    const second = await session.build()
    const secondActivation = session.beginActivation({
      revision: second.builtRevision!, viewId: "view-a", route: "dir-module",
    })
    const failed = session.failActivation({
      revision: secondActivation.revision,
      activationId: secondActivation.activationId,
      diagnostic: StorybookPackageSession.diagnostic("activation", "runtime.create failed"),
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
      revision: built.builtRevision!, viewId: "view-first", route: "dir-module",
    })
    const second = session.beginActivation({
      revision: built.builtRevision!, viewId: "view-second", route: "dir-module",
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
      if (fail) throw StorybookPackageSession.buildError(StorybookPackageSession.diagnostic("compile", "Unexpected token", input.descriptor.sourcePath))
      return successfulBuild(input.stagingDirectory)
    }, [])
    const first = await session.ensureBuilt()
    const activation = session.beginActivation({
      revision: first.builtRevision!, viewId: "view-a", route: "dir-module",
    })
    const working = session.acknowledgeActivation({...activation, frameSequence: 1})
    fail = true
    session.reconfigure(descriptor(root, "@fixture/a", "broken"))
    const failed = await session.build()
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

  test("обновление дескриптора не отменяет выполняемую сборку; следующий явный запрос использует новый снимок", async () => {
    const root = fixtureRoot("captured-descriptor")
    let calls = 0
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const entered = new Promise<void>(resolve => { started = resolve })
    const events: StorybookPackageEvent[] = []
    const builtDigests: string[] = []
    let aborted = false
    const session = createSession(descriptor(root, "@fixture/a", "one"), async input => {
      calls++
      builtDigests.push(input.descriptor.declarationDigest)
      input.signal.addEventListener("abort", () => { aborted = true })
      if (calls === 1) {
        started()
        await gate
      }
      return successfulBuild(input.stagingDirectory)
    }, events)
    const unsubscribe = session.subscribe()
    const first = session.build()
    const duplicate = session.build()
    await entered
    session.reconfigure(descriptor(root, "@fixture/a", "two"))
    const joined = session.build()
    release()
    const [built, same, again] = await Promise.all([first, duplicate, joined])
    expect(calls).toBe(1)
    expect(aborted).toBeFalse()
    expect(same.builtRevision).toBe(built.builtRevision)
    expect(again.builtRevision).toBe(built.builtRevision)
    expect(built).toMatchObject({generation: 1, buildState: "built", declarationDigest: "digest-one", lastBuildReason: "explicit-build"})
    expect(events.filter(event => event.type === "package.built")).toHaveLength(1)
    expect(session.revisionGraphSnapshot(built.builtRevision!)?.declarationDigest).toBe("digest-one")
    expect((await session.ensureBuilt({owner: "open"})).builtRevision).toBe(built.builtRevision)
    const lease = session.beginActivation({revision: built.builtRevision!, viewId: "view", route: ""})
    session.acknowledgeActivation({...lease, frameSequence: 1})
    const next = await session.build()
    expect(next.builtRevision).not.toBe(built.builtRevision)
    expect(next).toMatchObject({generation: 2, buildState: "built", declarationDigest: "digest-two", lastBuildReason: "explicit-build"})
    expect(builtDigests).toEqual(["digest-one", "digest-two"])
    expect(events.filter(event => event.type === "package.built")).toHaveLength(2)
    unsubscribe()
    await session.dispose()
  })

  test("keeps inactive reconfigure stale until an explicit check requests its latest generation", async () => {
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
      generation: 1,
      builds: 1,
    })
    expect(builtDigests).toEqual(["digest-one"])

    const unsubscribe = session.subscribe()
    expect((await session.ensureBuilt({owner: "open"})).builds).toBe(1)
    await session.build({owner: "check"})
    await waitFor(() => session.snapshot().builds === 2 && session.snapshot().buildState === "built")
    expect(builtDigests).toEqual(["digest-one", "digest-two"])
    expect(session.snapshot().revisions?.at(-1)?.generation).toBe(2)
    unsubscribe()
  })

  test("does not restart a failed package while it has no subscribers", async () => {
    const root = fixtureRoot("inactive-failure")
    const session = createSession(descriptor(root, "@fixture/a", "one"), async (input) => {
      throw StorybookPackageSession.buildError(StorybookPackageSession.diagnostic("compile", "broken fixture", input.descriptor.sourcePath))
    }, [])
    await session.ensureBuilt()
    expect(session.snapshot()).toMatchObject({subscribers: 0, builds: 1, buildState: "failed"})

    session.reconfigure(descriptor(root, "@fixture/a", "two"))
    await Bun.sleep(20)
    expect(session.snapshot()).toMatchObject({subscribers: 0, generation: 1, builds: 1})

    expect(session.reconfigure(descriptor(root, session.packageId, `next-${session.snapshot().generation}`))).toBeTrue()
    await Bun.sleep(20)
    expect(session.snapshot()).toMatchObject({subscribers: 0, generation: 1, builds: 1})
  })

  test("recovers a subscribed package after the next explicit check fixes its failed generation", async () => {
    const root = fixtureRoot("active-failure-recovery")
    let fail = false
    const session = createSession(descriptor(root, "@fixture/a"), async (input) => {
      if (fail) {
        throw StorybookPackageSession.buildError(StorybookPackageSession.diagnostic("compile", "broken fixture", input.descriptor.sourcePath))
      }
      return successfulBuild(input.stagingDirectory)
    }, [])
    const unsubscribe = session.subscribe()
    await session.build({owner: "check"})
    await waitFor(() => session.snapshot().buildState === "built")

    fail = true
    expect(session.reconfigure(descriptor(root, session.packageId, `next-${session.snapshot().generation}`))).toBeTrue()
    await session.build({owner: "check"})
    await waitFor(() => session.snapshot().buildState === "failed")
    fail = false
    expect(session.reconfigure(descriptor(root, session.packageId, `next-${session.snapshot().generation}`))).toBeTrue()
    await session.build({owner: "check"})
    await waitFor(() => session.snapshot().buildState === "built" && session.snapshot().builds === 3)
    expect(session.snapshot().diagnostics).toEqual([])
    unsubscribe()
  })

  test("обновляет каталог без пересборки независимо от подписчиков", async () => {
    const root = fixtureRoot("inactive-invalidation")
    const session = createSession(
      descriptor(root, "@fixture/a"),
      successfulBuilder(),
      [],
    )
    const unsubscribeFirst = session.subscribe()
    await session.ensureBuilt({owner: "check"})
    await waitFor(() => session.snapshot().builds === 1 && session.snapshot().buildState === "built")

    expect(session.reconfigure(descriptor(root, session.packageId, "two"))).toBeTrue()
    unsubscribeFirst()
    await Bun.sleep(80)
    expect(session.snapshot()).toMatchObject({subscribers: 0, generation: 1, builds: 1})

    expect(session.reconfigure(descriptor(root, session.packageId, "three"))).toBeTrue()
    await Bun.sleep(80)
    expect(session.snapshot()).toMatchObject({subscribers: 0, generation: 1, builds: 1})

    const unsubscribeLatest = session.subscribe()
    expect((await session.ensureBuilt({owner: "open"})).builds).toBe(1)
    await session.build({owner: "check"})
    await waitFor(() => session.snapshot().builds === 2 && session.snapshot().buildState === "built")
    expect(session.snapshot().revisions?.at(-1)?.generation).toBe(2)
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
    void session.ensureBuilt({owner: "check"})
    await started
    unsubscribe()
    expect(session.snapshot().subscribers).toBe(0)
    expect(aborted).toBeFalse()
    releaseBuild()
    await session.ensureBuilt({owner: "check"})
    await waitFor(() => session.snapshot().buildState === "built")
    expect(aborted).toBeFalse()
    expect(session.snapshot().builds).toBe(1)
  })

  test("сохраняет результат неактивной сборки до следующего явного заказа", async () => {
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
    expect(builtDigests).toEqual(["digest-one"])
    expect(session.snapshot()).toMatchObject({
      subscribers: 0,
      generation: 1,
      builds: 1,
      buildState: "built",
    })
    expect(session.snapshot().revisions?.at(-1)?.generation).toBe(1)
    await session.build()
    expect(builtDigests).toEqual(["digest-one", "digest-two"])
    expect(session.snapshot()).toMatchObject({generation: 2, builds: 2, buildState: "built"})
    await session.dispose()
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
      revision: first.builtRevision!, viewId: "view-a", route: "dir-module",
    })
    const firstWorking = session.acknowledgeActivation({...firstActivation, frameSequence: 1})
    const oldRevision = firstWorking.activeRevision!
    const lease = session.acquireRevisionLease(oldRevision, "view-lease")

    session.reconfigure(descriptor(root, "@fixture/a", "two"))
    const second = await session.build()
    const secondActivation = session.beginActivation({
      revision: second.builtRevision!, viewId: "view-a", route: "dir-module",
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
      completedGeneration: 1,
    })
    const refreshed = await restored.build()
    expect(refreshed).toMatchObject({
      activeRevision,
      builds: 1,
      buildState: "built",
    })
    expect(refreshed.builtRevision).not.toBe(activeRevision)
    await restored.dispose()
  })

  test("перенос identity требует новой ревизии и сохраняет строгий режим", async () => {
    const root = fixtureRoot("relocated-owner")
    const oldRoot = join(root, "old")
    const nextRoot = join(root, "next")
    mkdirSync(oldRoot)
    mkdirSync(nextRoot)
    const oldDescriptor = {...descriptor(oldRoot, "@fixture/moved"), repo: root}
    const nextDescriptor = {...descriptor(nextRoot, "@fixture/moved", "two"), repo: root}
    const first = createSession(oldDescriptor, async ({stagingDirectory}) => ({
      ...successfulBuild(stagingDirectory),
      verification: {status: "passed", diagnostics: []},
    }), [])
    const built = await first.ensureBuilt()
    const lease = first.beginActivation({revision: built.builtRevision!, viewId: "view", route: ""})
    first.acknowledgeActivation({...lease, frameSequence: 1})
    await first.dispose()
    const owner = readdirSync(join(root, ".artifacts"))[0]!
    const receiptPath = join(root, ".artifacts", owner, "applied.json")
    const originalReceipt = readFileSync(receiptPath, "utf8")
    rmSync(oldRoot, {recursive: true})
    let passed = false
    const modes: (string | undefined)[] = []
    const moved = createSession(nextDescriptor, async ({stagingDirectory, standard}) => {
      modes.push(standard)
      return {...successfulBuild(stagingDirectory), verification: {
        status: passed ? "passed" : "incomplete", diagnostics: [],
      }}
    }, [])
    try {
      expect(moved.snapshot(), "Перенос сохраняет строгость без восстановления прежнего исполнения").toMatchObject({
        standard: "strict", buildState: "idle", activeRevision: null, lastWorkingRevision: null,
        completedGeneration: 0, builds: 0, cacheOutcome: {status: "miss", layer: "receipt"}, diagnostics: [],
      })
      expect(await moved.ensureBuilt(), "Неполная новая проверка не понижает строгий режим")
        .toMatchObject({standard: "strict", buildState: "failed", activeRevision: null})
      expect(readFileSync(receiptPath, "utf8"), "Неудачная подготовка сохраняет прежнее свидетельство").toBe(originalReceipt)
      passed = true
      moved.retryFailed()
      const fresh = await moved.ensureBuilt()
      expect(fresh.buildState, "Исправленный пакет получает нового кандидата").toBe("built")
      expect(fresh.builtRevision, "Прежняя ревизия не подставляется за новый результат").not.toBe(built.builtRevision)
      const nextLease = moved.beginActivation({revision: fresh.builtRevision!, viewId: "new-view", route: ""})
      moved.acknowledgeActivation({...nextLease, frameSequence: 2})
      expect(JSON.parse(readFileSync(receiptPath, "utf8")).packageRoot, "Только применение закрепляет канонический путь нового физического владельца").toBe(realpathSync(nextRoot))
      expect(modes, "Обе новые попытки проверяются в прежнем строгом режиме").toEqual(["strict", "strict"])
    } finally {
      await moved.dispose()
    }
  })

  test.each([
    {name: "чужая identity", patch: {packageId: "@fixture/foreign"}},
    {name: "относительный корень", patch: {packageRoot: "old"}},
    {name: "повреждённый граф", patch: {graphSnapshot: null}},
    {name: "выход артефакта за границу", patch: {entryRelativePath: "../entry.js"}},
    {name: "отсутствующий вход артефакта", patch: {entryRelativePath: "missing.js"}},
    {name: "неизвестная строгость", patch: {standard: "unknown"}},
    {name: "повреждённая диагностика", patch: {warnings: [null]}},
  ])("перенос не скрывает нарушение receipt: $name", async ({patch}) => {
    const root = fixtureRoot("relocated-invalid")
    const oldRoot = join(root, "old")
    const nextRoot = join(root, "next")
    mkdirSync(oldRoot)
    mkdirSync(nextRoot)
    const value = {...descriptor(oldRoot, "@fixture/moved"), repo: root}
    const first = createSession(value, async ({stagingDirectory}) => ({
      ...successfulBuild(stagingDirectory),
    }), [])
    const built = await first.ensureBuilt()
    const lease = first.beginActivation({revision: built.builtRevision!, viewId: "view", route: ""})
    first.acknowledgeActivation({...lease, frameSequence: 1})
    await first.dispose()
    const owner = readdirSync(join(root, ".artifacts"))[0]!
    const receiptPath = join(root, ".artifacts", owner, "applied.json")
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"))
    writeFileSync(receiptPath, JSON.stringify({...receipt, ...patch}))
    const moved = createSession({...descriptor(nextRoot, "@fixture/moved"), repo: root}, successfulBuilder(), [])
    try {
      expect(await moved.ensureBuilt(), "Повреждённое свидетельство блокирует сборку и не восстанавливает ревизию")
        .toMatchObject({buildState: "failed", builds: 0, activeRevision: null, lastWorkingRevision: null})
      expect(moved.snapshot().diagnostics[0]?.phase, "Причина отказа относится к восстановлению опубликованного результата").toBe("publish")
    } finally {
      await moved.dispose()
    }
  })

  test.each([1, 2])("legacy receipt v%s восстанавливает артефакт без чтения удалённых исходников", async version => {
    const root = fixtureRoot("receipt-legacy")
    const value = descriptor(root, "@fixture/a")
    let builds = 0
    const builder: StorybookPackageRevisionBuilder = async ({stagingDirectory}) => {
      builds++
      return successfulBuild(stagingDirectory)
    }
    const first = createSession(value, builder, [])
    const built = await first.ensureBuilt()
    const activation = first.beginActivation({revision: built.builtRevision!, viewId: "view-a", route: "dir-module"})
    first.acknowledgeActivation({...activation, frameSequence: 1})
    await first.dispose()
    const owner = readdirSync(join(root, ".artifacts"))[0]!
    const receiptPath = join(root, ".artifacts", owner, "applied.json")
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"))
    writeFileSync(receiptPath, JSON.stringify({...receipt, version, inputFingerprint: {obsolete: true}}))
    rmSync(join(root, "module.ts"))
    rmSync(join(root, "package.json"))
    const restored = createSession(value, builder, [])
    expect(restored.snapshot()).toMatchObject({
      activeRevision: built.builtRevision, generation: 1, requestedGeneration: 0,
      completedGeneration: 1, builds: 0, cacheOutcome: {status: "hit", layer: "receipt"},
    })
    expect(restored.revisionDirectory(built.builtRevision!)).not.toBeNull()
    const unsubscribe = restored.subscribe()
    expect((await restored.ensureBuilt({owner: "open"})).activeRevision).toBe(built.builtRevision!)
    expect(builds).toBe(1)
    unsubscribe()
    await restored.dispose()
  })

  test("retired graph receipt becomes a cold cache miss while malformed receipt still fails", async () => {
    const root = fixtureRoot("receipt-retired-graph")
    const value = descriptor(root, "@fixture/a")
    let builds = 0
    const builder: StorybookPackageRevisionBuilder = async ({stagingDirectory}) => {
      builds += 1
      return successfulBuild(stagingDirectory)
    }
    const first = createSession(value, builder, [])
    const built = await first.ensureBuilt()
    const activation = first.beginActivation({revision: built.builtRevision!, viewId: "view-a", route: "dir-module"})
    first.acknowledgeActivation({...activation, frameSequence: 1})
    await first.dispose()

    const artifactRoot = join(root, ".artifacts")
    const ownerDirectories = readdirSync(artifactRoot).filter(name => existsSync(join(artifactRoot, name, "applied.json")))
    expect(ownerDirectories).toHaveLength(1)
    const receiptPath = join(artifactRoot, ownerDirectories[0]!, "applied.json")
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"))
    writeFileSync(receiptPath, JSON.stringify({...receipt, graphSnapshot: {
      ...receipt.graphSnapshot, protocol: "storybook-package-graph/4",
    }}))

    const restored = createSession(value, builder, [])
    expect(restored.snapshot()).toMatchObject({buildState: "idle", diagnostics: [], activeRevision: null,
      lastWorkingRevision: null, builds: 0})
    const fresh = await restored.ensureBuilt()
    expect(fresh).toMatchObject({buildState: "built", activeRevision: null, builds: 1})
    expect(restored.revisionGraphSnapshot(fresh.builtRevision!)?.protocol).toBe(Revision.protocol)
    expect(builds).toBe(2)
    await restored.dispose()

    const {protocol: _protocol, ...withoutProtocol} = receipt.graphSnapshot
    writeFileSync(receiptPath, JSON.stringify({...receipt, graphSnapshot: withoutProtocol}))
    const malformed = createSession(value, builder, [])
    expect(malformed.snapshot().buildState).toBe("failed")
    expect(malformed.snapshot().diagnostics[0]?.phase).toBe("publish")
    await malformed.dispose()
  })

  test("изменение исходников во время успешной сборки не отменяет готового кандидата", async () => {
    const root = fixtureRoot("source-edit-during-build")
    const value = descriptor(root, "@fixture/a")
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const entered = new Promise<void>(resolve => { started = resolve })
    let aborted = false
    const session = createSession(value, async input => {
      input.signal.addEventListener("abort", () => { aborted = true })
      started()
      await gate
      return successfulBuild(input.stagingDirectory)
    }, [])
    const pending = session.build()
    await entered
    writeFileSync(join(root, "module.ts"), "export const changed = true\n")
    release()
    const built = await pending
    expect(built).toMatchObject({buildState: "built", builds: 1, diagnostics: []})
    expect(aborted).toBeFalse()
    expect(session.revisionDirectory(built.builtRevision!)).not.toBeNull()
    const lease = session.beginActivation({revision: built.builtRevision!, viewId: "view", route: ""})
    session.acknowledgeActivation({...lease, frameSequence: 1})
    await session.dispose()
    rmSync(join(root, "module.ts"))
    rmSync(join(root, "package.json"))
    const restored = createSession(value, successfulBuilder(), [])
    expect((await restored.ensureBuilt({owner: "open"}))).toMatchObject({
      activeRevision: built.builtRevision, lastWorkingRevision: built.builtRevision, builds: 0,
    })
    const owner = readdirSync(join(root, ".artifacts"))[0]!
    const receipt = JSON.parse(readFileSync(join(root, ".artifacts", owner, "applied.json"), "utf8"))
    expect(receipt.inputFingerprint).toBeUndefined()
    await restored.dispose()
  })

  test("явная повторная сборка компилирует неизменный пакет, одновременные запросы разделяют работу", async () => {
    const root = fixtureRoot("explicit-rebuild")
    let calls = 0
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const entered = new Promise<void>(resolve => { started = resolve })
    const session = createSession(descriptor(root, "@fixture/a"), async input => {
      calls++
      if (calls === 2) {
        started()
        await gate
      }
      return successfulBuild(input.stagingDirectory)
    }, [])
    const first = await session.build()
    const open = await session.ensureBuilt({owner: "open"})
    expect(open.builtRevision).toBe(first.builtRevision)
    expect(calls).toBe(1)
    const next = session.build()
    const duplicate = session.build()
    await entered
    release()
    const [second, same] = await Promise.all([next, duplicate])
    expect(second.builtRevision).toBe(same.builtRevision)
    expect(second.builtRevision).not.toBe(first.builtRevision)
    expect(calls).toBe(2)
    const third = await session.build()
    expect(third.builtRevision).not.toBe(second.builtRevision)
    expect(calls).toBe(3)
    await session.dispose()
  })

  test.each(["compile", "publish"] as const)("неудачная явная %s сохраняет рабочий артефакт после изменения исходников", async phase => {
    const root = fixtureRoot("explicit-failure")
    const value = descriptor(root, "@fixture/a")
    let failed = false
    const session = createSession(value, async input => {
      if (failed && phase === "compile") throw StorybookPackageSession.buildError(StorybookPackageSession.diagnostic("compile", "Compiler failed"))
      const result = successfulBuild(input.stagingDirectory)
      return failed ? {...result, entryRelativePath: "missing.js"} : result
    }, [])
    const built = await session.build()
    const lease = session.beginActivation({revision: built.builtRevision!, viewId: "view", route: ""})
    session.acknowledgeActivation({...lease, frameSequence: 1})
    const directory = session.revisionDirectory(built.builtRevision!)!
    const original = readFileSync(join(directory, "entry.js"), "utf8")
    writeFileSync(join(root, "module.ts"), "new source\n")
    failed = true
    const result = await session.build()
    expect(result).toMatchObject({buildState: "failed", activeRevision: built.builtRevision, lastWorkingRevision: built.builtRevision, builds: 2})
    expect(result.diagnostics[0]?.phase).toBe(phase)
    expect(readFileSync(join(directory, "entry.js"), "utf8")).toBe(original)
    expect(session.revisionDirectory(built.builtRevision!)).not.toBeNull()
    await session.dispose()
    const restored = createSession(value, successfulBuilder(), [])
    expect((await restored.ensureBuilt({owner: "open"}))).toMatchObject({activeRevision: built.builtRevision, builds: 0})
    await restored.dispose()
  })

  test("явная сборка восстанавливает работу после повреждённого receipt, сохраняя строгий стандарт", async () => {
    const root = fixtureRoot("corrupt-receipt-recovery")
    const value = descriptor(root, "@fixture/a")
    const first = createSession(value, async input => ({...successfulBuild(input.stagingDirectory),
      verification: {status: "passed", diagnostics: []}}), [])
    const built = await first.build()
    const lease = first.beginActivation({revision: built.builtRevision!, viewId: "view", route: ""})
    first.acknowledgeActivation({...lease, frameSequence: 1})
    await first.dispose()
    const owner = readdirSync(join(root, ".artifacts"))[0]!
    const receiptPath = join(root, ".artifacts", owner, "applied.json")
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"))
    writeFileSync(receiptPath, JSON.stringify({...receipt, graphSnapshot: null}))
    const corruptedReceipt = readFileSync(receiptPath, "utf8")
    const modes: (string | undefined)[] = []
    const restored = createSession(value, async input => {
      modes.push(input.standard)
      return {...successfulBuild(input.stagingDirectory), verification: {status: "passed", diagnostics: []}}
    }, [])
    expect((await restored.ensureBuilt({owner: "open"}))).toMatchObject({
      buildState: "failed", activeRevision: null, lastWorkingRevision: null, builds: 0, standard: "strict",
    })
    const next = await restored.build()
    expect(next).toMatchObject({buildState: "built", activeRevision: null, builds: 1, standard: "strict", diagnostics: [], lastBuildReason: "explicit-retry"})
    expect(modes).toEqual(["strict"])
    expect(next.builtRevision).not.toBe(built.builtRevision)
    expect(readFileSync(receiptPath, "utf8")).toBe(corruptedReceipt)
    const activation = restored.beginActivation({revision: next.builtRevision!, viewId: "view", route: ""})
    restored.acknowledgeActivation({...activation, frameSequence: 2})
    expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toMatchObject({revision: next.builtRevision, standard: "strict"})
    await restored.dispose()
  })

  test("binds exact per-operation phase and worker lifecycle to scheduler resources", async () => {
    const root = fixtureRoot("scheduler-hooks")
    const rows = [{pid: 100, parentPid: 1, cpuPercent: 9.5, rssBytes: 1048576, startedAt: "2026-09-11T08:00:00.000Z"}, {pid: 101, parentPid: 100, cpuPercent: 2.5, rssBytes: 262144, startedAt: "2026-09-11T08:00:01.000Z"}] satisfies StorybookTechProcessSample.Output
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
        specifier: "@immersive-ui/component/theme/theme.css",
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
    buildScheduler?: StorybookBuildScheduler
  }> = {},
): StorybookPackageSession {
  return new StorybookPackageSession(value, {
    artifactRoot: join(value.repo, ".artifacts"),
    buildRevision,
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
  const packageJsonPath = join(root, "package.json")
  const modulePath = join(root, "module.ts")
  writeFileSync(packageJsonPath, JSON.stringify({name: packageId}))
  writeFileSync(modulePath, "export const module = true\n")
  const declarationDigest = `digest-${version}`
  return {
    packageId,
    packageRoot: root,
    repo: root,
    sourcePath: packageJsonPath,
    declarationDigest,
    graphSnapshot: graphSnapshot(packageId, declarationDigest),
  }
}

function graphSnapshot(packageId: string, declarationDigest: string): StorybookPackageRevisionGraphSnapshot {
  const packageNodeId = `package:${packageId}`
  const directoryNodeId = `directory:${packageNodeId}/module`
  const urlPath = `/packages/${encodeURIComponent(packageId)}/`
  const withoutDigest = {
    protocol: Revision.protocol,
    packageId,
    declarationDigest,
    metadata: {parentId: null, label: packageId, ownerId: packageId, urlPath},
    ancestors: [],
    rootId: packageNodeId,
    nodes: [
      {id: packageNodeId, kind: "package" as const, ownerId: packageId, packageId, label: packageId,
        parentId: null, childIds: [directoryNodeId], urlPath, routePath: "", searchTerms: [packageId],
        hasModuleDocumentation: false, resourceUrl: `resources/nodes/${encodeURIComponent(packageNodeId)}/`},
      {id: directoryNodeId, kind: "directory" as const, ownerId: packageId, packageId, label: "module",
        parentId: packageNodeId, childIds: [], urlPath: `${urlPath}module`, routePath: "dir-module", searchTerms: ["module"],
        hasModuleDocumentation: false, resourceUrl: `resources/nodes/${encodeURIComponent(directoryNodeId)}/`},
    ],
    routes: [
      {path: "", urlPath, kind: "overview" as const, nodeId: packageNodeId},
      {path: "dir-module", urlPath: `${urlPath}module`, kind: "overview" as const, nodeId: directoryNodeId},
    ],
    resources: [],
    workbenchAuthorStyleSheets: [],
  }
  return Object.freeze({...withoutDigest,
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

function fixtureRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `storybook-session-${name}-`))
  roots.push(root)
  return root
}
