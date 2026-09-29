import {expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {saveSharedBrowserReceipt} from "../build/shared-browser-receipt"
import {storybookSharedBrowserIdentity} from "../build/shared-module-identity"
import {startExternalStorybookServer} from "./server"

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
  const server = await startExternalStorybookServer({statePath: join(root, "state/server.json"), artifactRoot: join(root, "artifacts")})
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
    expect(server.sessions.snapshots()).toEqual([])
    expect(server.sessions.buildSchedulerSnapshot().recent).toEqual([])
  } finally {
    socket?.close()
    await server.stop()
    rmSync(root, {recursive: true, force: true})
  }
}, 10000)
