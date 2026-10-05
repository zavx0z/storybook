import {readyBrowser} from "./browser.fixture"
import {expect, spyOn, test} from "bun:test"
import createControl from "@zavx0z/storybook-app-control"
import createWeb from "@zavx0z/storybook-app-web"
import State from "@zavx0z/storybook-app-server-state"
import WebBuild from "@zavx0z/storybook-app-web-build"
import type {StorybookPackageBuildPrepare} from "@zavx0z/storybook-package-build-prepare"
import type {StorybookAppServer} from "../contract"
import {StorybookEventHub} from "../src/events"
import {streamAppOperation} from "../src/app-stream"
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import {createProjectFixture} from "./project.fixture"
import {seedPublishedSharedAssets} from "./shared-assets.fixture"

test("public App через REST доставляет package/shared progress до результата, изолирует scope и освобождает наблюдение", async () => {
  const root = mkdtempSync(join(tmpdir(), "storybook-check-progress-"))
  const previousStateRoot = Bun.env.STORYBOOK_STATE_ROOT
  const stateRoot = join(root, "state")
  Bun.env.STORYBOOK_STATE_ROOT = stateRoot
  const selected = "@fixture/selected"
  const neighbor = "@fixture/neighbor"
  const cancelledPackage = "@fixture/cancelled"
  const repositories = [selected, neighbor, cancelledPackage].map(packageId => {
    const directory = join(root, packageId.split("/")[1]!)
    mkdirSync(directory, {recursive: true})
    writeFileSync(join(directory, "package.json"), JSON.stringify({name: packageId, version: "0.0.0", type: "module", private: true}))
    writeFileSync(join(directory, "index.ts"), "/** Пакет проверки progress.\n@packageDocumentation\n*/\nexport const value = 1\n")
    return directory
  })
  const artifactRoot = join(root, "artifacts")
  seedPublishedSharedAssets(artifactRoot)
  const platform = WebBuild.readPublishedReceipt({root: join(artifactRoot, "shared"), toolRoot: root, landingEntryPath: "", fallbackEntryPath: "", stagingDirectory: root})!.browserIdentity!
  const gate = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const firstProgress = Promise.withResolvers<void>()
  const cancelGate = Promise.withResolvers<void>()
  const cancelStarted = Promise.withResolvers<void>()
  const sharedGate = Promise.withResolvers<void>()
  const sharedStarted = Promise.withResolvers<void>()
  const sharedProgress = Promise.withResolvers<void>()
  const buildOwners: string[] = []
  const builder: StorybookPackageBuildPrepare.Output = async input => {
    buildOwners.push(input.descriptor.packageId)
    input.onPhase?.({phase: "exports", state: "started", at: new Date().toISOString()})
    if (input.descriptor.packageId === selected) {
      started.resolve()
      await gate.promise
    } else if (input.descriptor.packageId === cancelledPackage) {
      cancelStarted.resolve()
      await cancelGate.promise
    }
    input.signal.throwIfAborted()
    writeFileSync(join(input.stagingDirectory, "entry.js"), "export {}\n")
    return {
      moduleGraphRevision: "controlled-package-build",
      sharedModuleEpoch: platform.epoch,
      dependencyRealpaths: [],
      entryRelativePath: "entry.js",
    }
  }
  // Публичная factory подставляет только compiler; public App, REST, sessions и scheduler остаются настоящими.
  const prepare = await import("@zavx0z/storybook-package-build-prepare")
  const originalFactory = prepare.default
  const factory = spyOn(prepare, "default").mockImplementation(() => builder)
  const nativeSubscribe = StorybookEventHub.prototype.subscribe
  let subscriptions = 0
  const subscriptionSpy = spyOn(StorybookEventHub.prototype, "subscribe").mockImplementation(function (this: StorybookEventHub<Readonly<{type: string}>>, ...args) {
    const subscription = nativeSubscribe.apply(this, args)
    subscriptions += 1
    let closed = false
    return {...subscription, close() {
      if (!closed) {
        closed = true
        subscriptions -= 1
      }
      subscription.close()
    }}
  })
  let running: StorybookAppServer.Output | undefined
  let request: Promise<Record<string, unknown>> | undefined
  let cancelledRequest: Promise<Record<string, unknown>> | undefined
  let neighborBuild: ReturnType<StorybookAppServer.Output["sessions"]["ensure"]> | undefined
  let closeQueueObservation = () => {}
  const progress: Record<string, unknown>[] = []
  let finished = false
  try {
    const {default: startServer} = await import("../index")
    const {default: createApp} = await import("@zavx0z/storybook-app")
    const app = createApp({toolRoot: resolve(import.meta.dir, "../../.."), legacyStatePaths: []})
    const controls = createControl({controller: () => app})
    running = await startServer({
      extensions: input => input.inspectExecutors ? controls.tools : [],
      createWeb,
      preparePlatform: async input => {
        const assets = WebBuild.readPublishedReceipt({...input, landingEntryPath: "", fallbackEntryPath: "", stagingDirectory: input.root})!
        return {identity: assets.browserIdentity!, artifacts: assets.artifactDigests!.filter(artifact => artifact.path.startsWith("kernel/"))}
      },
      buildWeb: async (input, context) => {
        context.setPhase("kernel")
        sharedStarted.resolve()
        await sharedGate.promise
        context.signal.throwIfAborted()
        const assets = WebBuild.readPublishedReceipt({...input, stagingDirectory: input.root})
        if (assets === null) throw new Error("Fixture shared receipt отсутствует")
        return assets
      },
      project: createProjectFixture(root, repositories),
      statePath: join(stateRoot, "server.json"),
      artifactRoot,
      browserLifecycle: readyBrowser(() => running!),
    })
    const client = State.client(running.record)
    const baselineSubscriptions = subscriptions
    request = client.controlStream("/api/environment", {name: "storybook_check", arguments: {schemaVersion: 1, scope: selected}}, value => {
      progress.push(value)
      if (value.packageId === selected && value.phase === "exports") firstProgress.resolve()
    })
    void request.then(() => { finished = true }, () => { finished = true })
    await beforeResult(started.promise, request, "Контролируемая сборка не началась")
    expect(State.readExternalStorybookOperationProgress(running.record)?.event)
      .toMatchObject({type: "build.progress", packageId: selected, phase: "exports"})
    const neighborQueued = Promise.withResolvers<void>()
    closeQueueObservation = running.sessions.buildScheduler.subscribe(event => {
      if (event.packageId === neighbor && event.state === "queued") neighborQueued.resolve()
    })
    neighborBuild = running.sessions.ensure(neighbor, {owner: "check"})
    await bounded(neighborQueued.promise, "Соседний пакет не вошёл в общую очередь")
    await beforeResult(firstProgress.promise, request, "REST не доставил exports выбранного пакета до освобождения build gate")
    expect(finished, "Progress наблюдается во время незавершённой сборки").toBeFalse()
    expect(subscriptions, "HTTP stream удерживает наблюдение до финала").toBeGreaterThan(baselineSubscriptions)
    expect(running.sessions.buildSchedulerSnapshot().queued.some(value => value.packageId === neighbor)).toBeTrue()
    expect(progress.filter(value => typeof value.packageId === "string").every(value => value.packageId === selected), "Соседняя queued работа не попадает в request-scoped REST progress").toBeTrue()
    gate.resolve()
    const result = await request
    await neighborBuild
    expect(result).not.toHaveProperty("error")
    expect(result.result).toMatchObject({status: "success", ok: true, packages: [{packageId: selected, buildState: "active"}]})
    expect(running.sessions.session(selected).snapshot().activeRevision).toBeString()
    expect(buildOwners).toEqual([selected, neighbor])
    expect(subscriptions, "Завершение stream освобождает все временные подписки").toBe(baselineSubscriptions)
    const count = progress.length

    // Тот же вход без NDJSON отдаёт общий итоговый JSON envelope.
    const response = await fetch(new URL("/api/environment", running.origin), {
      method: "POST",
      headers: {authorization: `Bearer ${running.record.controlToken}`, "content-type": "application/json", accept: "application/json"},
      body: JSON.stringify({name: "storybook_check", arguments: {schemaVersion: 1, scope: neighbor}}),
    })
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(await response.json()).toMatchObject({result: {status: "success", ok: true, applied: true, packages: [{packageId: neighbor}]}})
    expect(progress.length, "После финала последующие проверки не продолжают закрытый REST progress").toBe(count)
    expect(subscriptions).toBe(baselineSubscriptions)

    // Отмена REST-ожидания закрывает оба HTTP-потока, но не работу принадлежащей серверу package session.
    const abort = new AbortController()
    cancelledRequest = client.controlStream("/api/environment", {name: "storybook_check", arguments: {schemaVersion: 1, scope: cancelledPackage}}, undefined, abort.signal)
    const cancelled = cancelledRequest.then(value => ({value}), error => ({error}))
    await beforeResult(cancelStarted.promise, cancelledRequest, "Отменяемая проверка не начала сборку")
    expect(subscriptions).toBeGreaterThan(baselineSubscriptions)
    abort.abort(new Error("Отменено ожидание клиента"))
    expect(await bounded(cancelled, "Отмена клиента не завершила его ожидание")).toMatchObject({error: expect.any(Error)})
    await until(() => subscriptions === baselineSubscriptions, "Отмена REST-наблюдения не освободила временные подписки")
    expect(running.sessions.session(cancelledPackage).snapshot().builtRevision).toBeNull()
    cancelGate.resolve()
    await until(() => running!.sessions.session(cancelledPackage).snapshot().builtRevision !== null, "Отключение клиента отменило серверную сборку")
    expect(running.sessions.session(cancelledPackage).snapshot().builtRevision).toBeString()
    expect(buildOwners).toEqual([selected, neighbor, neighbor, cancelledPackage])
    expect(progress.length, "Отдельная отменённая проверка не продолжает завершённый stream").toBe(count)

    const sharedEvents: Record<string, unknown>[] = []
    const buildsBeforeShared = [...buildOwners]
    request = client.controlStream("/api/environment", {name: "storybook_check", arguments: {schemaVersion: 1, scope: "storybook:shared"}}, value => {
      sharedEvents.push(value)
      if (value.packageId === null && value.phase === "kernel") sharedProgress.resolve()
    })
    await beforeResult(sharedStarted.promise, request, "Shared check не запустил предоставленный buildWeb")
    await beforeResult(sharedProgress.promise, request, "Shared check не доставил kernel до завершения buildWeb")
    sharedGate.resolve()
    expect((await request).result).toMatchObject({status: "success", ok: true})
    expect(sharedEvents.filter(value => "packageId" in value).every(value => value.packageId === null)).toBeTrue()
    expect(buildOwners, "Shared scope не компилирует пакеты").toEqual(buildsBeforeShared)
    expect(subscriptions, "Shared stream освобождает наблюдение после результата").toBe(baselineSubscriptions)
  } finally {
    gate.resolve()
    cancelGate.resolve()
    sharedGate.resolve()
    await Promise.allSettled([request, cancelledRequest, neighborBuild])
    closeQueueObservation()
    await running?.stop()
    subscriptionSpy.mockRestore()
    // Server сохраняет ссылку factory при импорте; возвращаем её штатное поведение также для следующих тестов.
    factory.mockImplementation(originalFactory)
    factory.mockRestore()
    if (previousStateRoot === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
    else Bun.env.STORYBOOK_STATE_ROOT = previousStateRoot
    rmSync(root, {recursive: true, force: true})
  }
}, 30_000)

async function beforeResult(operation: Promise<void>, request: Promise<Record<string, unknown>>, message: string): Promise<void> {
  return bounded(Promise.race([operation, request.then(result => {
    throw new Error(`${message}: REST request уже завершился: ${JSON.stringify(result)}`)
  })]), message)
}

async function until(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function bounded<Value>(operation: Promise<Value>, message: string): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 5_000)
    })])
  } finally {
    clearTimeout(timer)
  }
}

test.each(["error", "abort", "cancel"] as const)("HTTP operation stream освобождает подписку при %s", async mode => {
  const abort = new AbortController()
  const operation = Promise.withResolvers<Record<string, unknown>>()
  let active = 0
  let releaseCount = 0
  let notify: ((event: Readonly<Record<string, unknown>>) => void) | undefined
  const response = streamAppOperation(abort.signal, listener => {
    active += 1
    notify = listener
    return () => {
      active -= 1
      releaseCount += 1
    }
  }, () => operation.promise)
  const reader = response.body!.getReader()
  expect(active).toBe(1)
  notify!({phase: "kernel"})
  expect(JSON.parse(new TextDecoder().decode((await reader.read()).value))).toEqual({type: "progress", progress: {phase: "kernel"}})
  if (mode === "error") {
    operation.reject(new Error("Контролируемый отказ сборки"))
    expect(JSON.parse(new TextDecoder().decode((await reader.read()).value))).toEqual({type: "error", error: "Контролируемый отказ сборки"})
    expect((await reader.read()).done).toBeTrue()
  } else {
    if (mode === "abort") abort.abort()
    else await reader.cancel()
    expect((await reader.read()).done).toBeTrue()
    expect(active, "Отключение HTTP-клиента освобождает подписку до завершения общей работы").toBe(0)
    notify!({phase: "after-close"})
    operation.resolve({ok: true})
    await operation.promise
    await Promise.resolve()
  }
  expect(active).toBe(0)
  expect(releaseCount, "Очистка подписки выполняется один раз").toBe(1)
  reader.releaseLock()
})
