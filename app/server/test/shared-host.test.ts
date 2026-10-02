import {createProjectFixture} from "./project.fixture.ts"
import createWeb from "@web/release"
import AppWebBuildOwner, {type AppWebBuild} from "@app-web/build"
import BuildEnvironmentOwner from "@build/environment"
import BuildArtifactsOwner from "@build/artifacts"
const readPublishedSharedBrowserReceipt = AppWebBuildOwner.readPublishedReceipt
const saveSharedBrowserReceipt = AppWebBuildOwner.saveReceipt
const storybookSharedBrowserIdentity = BuildEnvironmentOwner.identity
type SharedBrowserAssets = Awaited<ReturnType<AppWebBuild.Output["buildAssets"]>>
import {expect, mock, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import startExternalStorybookServer from "../index"

test("shared check передаёт точный immutable collision от publisher как HTTP error", async () => {
  const fixture = retainedHostFixture()
  const path = fixture.current.landingEntry
  const target = join(fixture.current.root, path)
  const originalBytes = readFileSync(target)
  writeFileSync(target, "damaged output")
  const build = mock<AppWebBuild.Output["runWorker"]>(async input => {
    const staging = join(fixture.root, "collision-candidate")
    mkdirSync(dirname(join(staging, path)), {recursive: true})
    writeFileSync(join(staging, path), originalBytes)
    BuildArtifactsOwner.publish(input.root, staging, [{
      path,
      digest: createHash("sha256").update(originalBytes).digest("hex"),
    }])
    return fixture.current
  })
  let server: Awaited<ReturnType<typeof startExternalStorybookServer>> | undefined
  try {
    server = await startExternalStorybookServer({createWeb, implementationDigest: "a".repeat(64),
      ...fixture.options, buildWeb: build})
    const response = await fetch(new URL("/api/control/check", server.origin), {
      method: "POST",
      headers: {authorization: `Bearer ${server.record.controlToken}`, "content-type": "application/json"},
      body: JSON.stringify({scope: "storybook:shared"}),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({error: `Immutable shared artifact collision: ${path}`})
    expect(readFileSync(target)).toEqual(Buffer.from("damaged output"))
  } finally {
    await server?.stop()
    build.mockRestore()
    rmSync(fixture.root, {recursive: true, force: true})
  }
}, 10000)

/** Server read/event contract проверяется готовыми артефактами без запуска compiler и browser. */
test("общая оболочка читается и доставляется подписчику без сборки пакетов", async () => {
  const root = mkdtempSync(join(tmpdir(), "shared-host-server-"))
  const assetsRoot = join(root, "artifacts/shared")
  mkdirSync(assetsRoot, {recursive: true})
  const sourcePath = join(root, "source.ts")
  writeFileSync(sourcePath, "export {}")
  const digest = (value: string) => createHash("sha256").update(value).digest("hex")
  const paths = ["kernel/fixture.js", "entries/page.js", "entries/package.js", "entries/bootstrap.js"]
  for (const path of paths) {
    mkdirSync(dirname(join(assetsRoot, path)), {recursive: true})
    writeFileSync(join(assetsRoot, path), "export {}")
  }
  const identity = storybookSharedBrowserIdentity("/__storybook/shared/entries/page.js", [{
    specifier: "@zavx0z/component", sourcePath, url: "/__storybook/shared/kernel/fixture.js",
  }], digest("host"), [{path: sourcePath, contentDigest: digest("export {}")}], "/__storybook/shared/entries/package.js")
  saveSharedBrowserReceipt({root: assetsRoot, landingEntry: paths[1]!, fallbackEntry: paths[1]!, bootstrapEntry: paths[3]!,
    browserIdentity: identity, dependencyRealpaths: [sourcePath], authorStyleSheets: [],
    artifactDigests: paths.map(path => ({path, digest: digest("export {}")}))})
  const server = await startExternalStorybookServer({createWeb, implementationDigest: "a".repeat(64), project: createProjectFixture(root, []), statePath: join(root, "state/server.json"), artifactRoot: join(root, "artifacts")})
  let socket: WebSocket | undefined
  try {
    const html = await (await fetch(server.origin)).text()
    const token = html.match(/name="external-storybook-browser-session" content="([^"]+)"/)?.[1]
    expect(token).toBeString()
    expect((await fetch(new URL("/api/browser/shared", server.origin))).status).toBe(401)
    const read = (query = "") => fetch(new URL(`/api/browser/shared${query}`, server.origin), {headers: {"x-storybook-session": token!}})
    expect((await read("?preview=1")).status).toBe(403)
    expect((await read("?preview=0")).ok).toBeFalse()
    const host = await (await read()).json()
    expect(host).toMatchObject({protocol: "storybook-shared-host/1", sharedModuleEpoch: identity.epoch, hostModuleEpoch: identity.hostModuleEpoch})
    expect(await (await read(`?sharedModuleEpoch=${identity.epoch}`)).json()).toEqual(host)
    expect((await read(`?sharedModuleEpoch=${"a".repeat(64)}`)).ok).toBeFalse()
    expect((await fetch(new URL("/__storybook/shared/receipt.json", server.origin))).status).toBe(404)
    expect((await fetch(new URL("/__storybook/shared/candidate.json", server.origin))).status).toBe(404)
    expect((await fetch(new URL(`/__storybook/shared/hosts/${identity.epoch}.json`, server.origin))).status).toBe(404)
    const url = new URL(`/api/events?session=${token}`, server.origin)
    url.protocol = "ws:"
    const events: any[] = []
    socket = new WebSocket(url, {headers: {Origin: server.origin}} as never)
    socket.addEventListener("message", event => events.push(JSON.parse(String(event.data))))
    await new Promise<void>(resolve => socket!.addEventListener("open", () => resolve(), {once: true}))
    socket.send(JSON.stringify({type: "subscribe", topic: "registry"}))
    const deadline = Date.now() + 1000
    while (!events.some(event => event.type === "shared.updated") && Date.now() < deadline) await Bun.sleep(5)
    expect(events.find(event => event.type === "shared.updated")?.host).toEqual(host)
    expect(events.find(event => event.type === "shared.updated")?.entry).toBe(host.pageEntryUrl)
    expect(server.sessions.snapshots()).toEqual([])
    expect(server.sessions.buildSchedulerSnapshot().recent).toEqual([])
  } finally {
    socket?.close()
    await server.stop()
    rmSync(root, {recursive: true, force: true})
  }
}, 10000)

test("отмена shared check сохраняет подготовку retained host для следующего запроса без поздней публикации", async () => {
  const fixture = retainedHostFixture()
  const retained = Promise.withResolvers<SharedBrowserAssets>()
  const started = Promise.withResolvers<AbortSignal>()
  let retainedBuilds = 0
  const build = mock<AppWebBuild.Output["runWorker"]>(async (input, context) => {
    if (input.sharedKernel === undefined) return fixture.current
    retainedBuilds += 1
    started.resolve(context.signal)
    return retained.promise
  })
  let server: Awaited<ReturnType<typeof startExternalStorybookServer>> | undefined
  try {
    server = await startExternalStorybookServer({createWeb, implementationDigest: "a".repeat(64), ...fixture.options, buildWeb: build})
    const read = await requestRetainedHost(server, fixture.archived)
    const cancellation = new AbortController()
    const first = sharedCheck(server, true, cancellation.signal).then(
      response => ({response, error: null}),
      error => ({response: null, error}),
    )
    const operationSignal = await started.promise
    cancellation.abort()
    const canceled = await first
    expect(canceled.response).toBeNull()
    expect(canceled.error).toMatchObject({name: "AbortError"})

    let secondSettled = false
    const second = sharedCheck(server, false).finally(() => { secondSettled = true })
    await Bun.sleep(25)
    expect(secondSettled).toBeFalse()
    expect(operationSignal.aborted).toBeFalse()
    expect(retainedBuilds).toBe(1)
    retained.resolve(fixture.compatible)
    const response = await second
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      published: false,
      hosts: [
        {sharedModuleEpoch: fixture.current.browserIdentity!.epoch},
        {sharedModuleEpoch: fixture.archived.browserIdentity!.epoch},
      ],
    })
    expect(retainedBuilds).toBe(1)
    expect(readPublishedSharedBrowserReceipt(fixture.receiptInput)).toEqual(fixture.current)
    expect((await read()).status).toBe(400)
    expect(server.sessions.snapshots()).toEqual([])
  } finally {
    retained.resolve(fixture.compatible)
    await server?.stop()
    build.mockRestore()
    rmSync(fixture.root, {recursive: true, force: true})
  }
}, 10000)

test("остановка сервера отменяет retained host и ждёт завершения его cleanup", async () => {
  const fixture = retainedHostFixture()
  const started = Promise.withResolvers<AbortSignal>()
  const aborted = Promise.withResolvers<void>()
  const cleanup = Promise.withResolvers<void>()
  let cleaned = false
  const build = mock<AppWebBuild.Output["runWorker"]>(async (input, context) => {
    if (input.sharedKernel === undefined) return fixture.current
    started.resolve(context.signal)
    await new Promise<void>(resolve => context.signal.addEventListener("abort", () => {
      aborted.resolve()
      resolve()
    }, {once: true}))
    await cleanup.promise
    cleaned = true
    context.signal.throwIfAborted()
    return fixture.compatible
  })
  let server: Awaited<ReturnType<typeof startExternalStorybookServer>> | undefined
  let check: Promise<Response | null> | undefined
  try {
    server = await startExternalStorybookServer({createWeb, implementationDigest: "a".repeat(64), ...fixture.options, buildWeb: build})
    await requestRetainedHost(server, fixture.archived)
    check = sharedCheck(server, false).catch(() => null)
    const operationSignal = await started.promise
    let stopped = false
    const stopping = server.stop().then(() => { stopped = true })
    await aborted.promise
    expect(operationSignal.aborted).toBeTrue()
    await Bun.sleep(25)
    expect(stopped).toBeFalse()
    expect(cleaned).toBeFalse()
    cleanup.resolve()
    await stopping
    expect(cleaned).toBeTrue()
    expect(stopped).toBeTrue()
    expect(readPublishedSharedBrowserReceipt(fixture.receiptInput)).toEqual(fixture.current)
  } finally {
    cleanup.resolve()
    await server?.stop()
    await check
    build.mockRestore()
    rmSync(fixture.root, {recursive: true, force: true})
  }
}, 10000)

/** Создаёт две сохранённые платформы и результат host для прежнего kernel без компилятора. */
function retainedHostFixture() {
  const root = mkdtempSync(join(tmpdir(), "shared-host-lifetime-"))
  const assetsRoot = join(root, "artifacts/shared")
  const sourcePath = join(root, "source.ts")
  mkdirSync(assetsRoot, {recursive: true})
  writeFileSync(sourcePath, "export {}")
  const digest = (value: string) => createHash("sha256").update(value).digest("hex")
  const assets = (kernel: string, host: string): SharedBrowserAssets => {
    const paths = [`kernel/${kernel}.js`, `entries/${kernel}-page.js`, `entries/${kernel}-package.js`, `entries/${kernel}-bootstrap.js`]
    for (const path of paths) {
      mkdirSync(dirname(join(assetsRoot, path)), {recursive: true})
      writeFileSync(join(assetsRoot, path), "export {}")
    }
    return {
      root: assetsRoot,
      landingEntry: paths[1]!,
      fallbackEntry: paths[1]!,
      bootstrapEntry: paths[3]!,
      browserIdentity: storybookSharedBrowserIdentity(`/__storybook/shared/${paths[1]}`, [{
        specifier: "@zavx0z/component", sourcePath, url: `/__storybook/shared/${paths[0]}`,
      }], digest(host), [{path: sourcePath, contentDigest: digest("export {}")}], `/__storybook/shared/${paths[2]}`),
      dependencyRealpaths: [sourcePath],
      authorStyleSheets: [],
      artifactDigests: paths.map(path => ({path, digest: digest("export {}")})),
    }
  }
  const archived = assets("a", "old-host")
  const current = assets("b", "current-host")
  const compatible = assets("a", "current-host")
  saveSharedBrowserReceipt(archived)
  saveSharedBrowserReceipt(current)
  return {
    root,
    archived,
    current,
    compatible,
    options: {project: createProjectFixture(root, []), statePath: join(root, "state/server.json"), artifactRoot: join(root, "artifacts")},
    receiptInput: {root: assetsRoot, toolRoot: root, landingEntryPath: sourcePath, fallbackEntryPath: sourcePath, stagingDirectory: root},
  }
}

test("Minimap и управляющий app разделяют одну пересборку Web с готовой платформой", async () => {
  const fixture = retainedHostFixture()
  const gate = Promise.withResolvers<SharedBrowserAssets>()
  const started = Promise.withResolvers<void>()
  let calls = 0
  const build = mock<AppWebBuild.Output["runWorker"]>(async input => {
    calls += 1
    expect(input.sharedKernel?.epoch).toBe(fixture.current.browserIdentity!.epoch)
    started.resolve()
    return gate.promise
  })
  let server: Awaited<ReturnType<typeof startExternalStorybookServer>> | undefined
  try {
    server = await startExternalStorybookServer({createWeb, implementationDigest: "a".repeat(64), ...fixture.options, buildWeb: build})
    const origin = server.origin
    const control = {authorization: `Bearer ${server.record.controlToken}`, "content-type": "application/json"}
    const before = await (await fetch(new URL("/api/control/status", origin), {headers: control})).json()
    const noSession = await fetch(new URL("/api/browser/app/web/rebuild", origin), {
      method: "POST", headers: {origin, "content-type": "application/json"}, body: "{}",
    })
    expect(noSession.ok).toBeFalse()
    expect(calls).toBe(0)
    const session = await (await fetch(new URL("/api/browser/registry-session", origin), {
      method: "POST", headers: {origin, "content-type": "application/json"}, body: "{}",
    })).json()
    const browser = fetch(new URL("/api/browser/app/web/rebuild", origin), {
      method: "POST", headers: {origin, "content-type": "application/json", "x-storybook-session": session.readerToken}, body: "{}",
    })
    await started.promise
    const agent = await fetch(new URL("/api/control/app/web/rebuild", origin), {
      method: "POST", headers: {...control, accept: "application/x-ndjson"}, body: JSON.stringify({live: true}),
    })
    const reader = agent.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toContain('"phase":"preparing"')
    expect(calls).toBe(1)
    gate.resolve(fixture.current)
    expect(await (await browser).json()).toMatchObject({ok: true, published: true, applied: false})
    let text = ""
    while (true) {
      const part = await reader.read()
      if (part.done) break
      text += new TextDecoder().decode(part.value)
    }
    expect(text).toContain('"type":"result"')
    expect(text).toContain('"phase":"published"')
    const after = await (await fetch(new URL("/api/control/status", origin), {headers: control})).json()
    expect(after.graphDigest).toBe(before.graphDigest)
    expect(after.discovery).toEqual(before.discovery)
    expect(server.sessions.snapshots()).toEqual([])
    expect(calls).toBe(1)
    const warm = await fetch(new URL("/api/control/check", origin), {
      method: "POST", headers: control, body: JSON.stringify({scope: "storybook:web", live: true}),
    })
    expect(warm.ok).toBeTrue()
    expect(calls).toBe(1)
  } finally {
    gate.resolve(fixture.current)
    await server?.stop()
    build.mockRestore()
    rmSync(fixture.root, {recursive: true, force: true})
  }
}, 10000)

test("ошибка явного выпуска Web сохраняет опубликованную среду", async () => {
  const fixture = retainedHostFixture()
  const build = mock<AppWebBuild.Output["runWorker"]>(async () => { throw new Error("Web compilation failed") })
  let server: Awaited<ReturnType<typeof startExternalStorybookServer>> | undefined
  try {
    server = await startExternalStorybookServer({createWeb, implementationDigest: "a".repeat(64), ...fixture.options, buildWeb: build})
    const response = await fetch(new URL("/api/control/app/web/rebuild", server.origin), {
      method: "POST", headers: {authorization: `Bearer ${server.record.controlToken}`, "content-type": "application/json"}, body: "{}",
    })
    expect(response.ok).toBeFalse()
    expect(await response.json()).toEqual({error: "Web compilation failed"})
    expect(readPublishedSharedBrowserReceipt(fixture.receiptInput)).toEqual(fixture.current)
    expect(server.sessions.snapshots()).toEqual([])
  } finally {
    await server?.stop()
    build.mockRestore()
    rmSync(fixture.root, {recursive: true, force: true})
  }
}, 10000)

/** Запрашивает прежнюю платформу через настоящий browser grant и регистрирует потребность в её host. */
async function requestRetainedHost(
  server: Awaited<ReturnType<typeof startExternalStorybookServer>>,
  archived: SharedBrowserAssets,
): Promise<() => Promise<Response>> {
  const html = await (await fetch(server.origin)).text()
  const token = html.match(/name="external-storybook-browser-session" content="([^"]+)"/)?.[1]
  expect(token).toBeString()
  const read = () => fetch(new URL(`/api/browser/shared?sharedModuleEpoch=${archived.browserIdentity!.epoch}`, server.origin), {
    headers: {"x-storybook-session": token!},
  })
  expect((await read()).status).toBe(400)
  return read
}

/** Выполняет авторизованный HTTP check с независимой отменой ожидания. */
function sharedCheck(
  server: Awaited<ReturnType<typeof startExternalStorybookServer>>,
  live: boolean,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(new URL("/api/control/check", server.origin), {
    method: "POST",
    headers: {authorization: `Bearer ${server.record.controlToken}`, "content-type": "application/json"},
    body: JSON.stringify({scope: "storybook:shared", live}),
    ...(signal === undefined ? {} : {signal}),
  })
}
