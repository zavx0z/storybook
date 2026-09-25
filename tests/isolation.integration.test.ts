import {afterEach, describe, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {storybookPackageUrlPath} from "@zavx0z/storybook-browser-lifecycle/contract"
import {startExternalStorybookServer, type ExternalStorybookRunningServer} from "../server/server.ts"

const roots: string[] = []
const servers: ExternalStorybookRunningServer[] = []
const isolationTest = process.env.STORYBOOK_SKIP_ISOLATION === "1" ? test.skip : test

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.stop()))
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("one-server structural package isolation", () => {
  isolationTest("A metadata update and failure preserve B/C revisions and A last working revision", async () => {
    const fixture = createFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.projectRoot], statePath: join(fixture.root, "state/server.json"),
      artifactRoot: join(fixture.root, "artifacts"),
      browserLifecycle: {
        async listViews() { return [] },
        openPackage: unexpectedBrowserAction, getView: unexpectedBrowserAction,
        inspect: unexpectedBrowserAction, interact: unexpectedBrowserAction,
        capture: unexpectedBrowserAction, close: unexpectedBrowserAction,
        readCapture: unexpectedBrowserAction,
      },
    })
    servers.push(running)
    await Promise.all([running.sessions.ensure("@fixture/a"), running.sessions.ensure("@fixture/b")])
    activate(running, "@fixture/a")
    activate(running, "@fixture/b")
    const aSocket = await packageSocket(running.origin, "@fixture/a")
    const bSocket = await packageSocket(running.origin, "@fixture/b")
    try {
      const firstA = running.sessions.session("@fixture/a").snapshot()
      const firstB = running.sessions.session("@fixture/b").snapshot()
      expect(firstA.buildState).toBe("active")
      expect(firstB.buildState).toBe("active")
      expect(running.sessions.session("@fixture/c").snapshot().builds).toBe(0)
      aSocket.clear()
      bSocket.clear()

      writeFileSync(fixture.aMetadata, JSON.stringify({name: "@fixture/a", label: "A2"}))
      await waitFor(() => running.sessions.session("@fixture/a").snapshot().builtRevision !== firstA.activeRevision &&
        running.sessions.session("@fixture/a").snapshot().buildState === "built")
      expect(await aSocket.waitFor("package.built")).toMatchObject({packageId: "@fixture/a"})
      activate(running, "@fixture/a")
      const updatedA = running.sessions.session("@fixture/a").snapshot()
      expect(updatedA.activeRevision).not.toBe(firstA.activeRevision)
      expect(running.sessions.session("@fixture/b").snapshot().activeRevision).toBe(firstB.activeRevision)
      expect(running.sessions.session("@fixture/c").snapshot().builds).toBe(0)
      expect(bSocket.messages.some(event => event.type === "package.updated")).toBeFalse()

      writeFileSync(fixture.aMetadata, "{")
      await waitFor(() => running.sessions.session("@fixture/a").snapshot().buildState === "failed")
      const failedA = running.sessions.session("@fixture/a").snapshot()
      expect(failedA.activeRevision).toBe(updatedA.activeRevision)
      expect(failedA.lastWorkingRevision).toBe(updatedA.lastWorkingRevision)
      expect(failedA.diagnostics[0]?.phase).toBe("resolve")
      expect(running.sessions.session("@fixture/b").snapshot().activeRevision).toBe(firstB.activeRevision)

      writeFileSync(fixture.aMetadata, JSON.stringify({name: "@fixture/a", label: "A3"}))
      await waitFor(() => running.sessions.session("@fixture/a").snapshot().buildState === "built")
      activate(running, "@fixture/a")
      expect(running.sessions.session("@fixture/a").snapshot().diagnostics).toEqual([])
      expect((await fetch(new URL("/api/health", running.origin))).status).toBe(200)
    } finally {
      aSocket.close()
      bSocket.close()
    }
  }, 180_000)
})

function createFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-isolation-")))
  roots.push(root)
  const projectRoot = join(root, "project")
  const packages = ["a", "b", "c"] as const
  mkdirSync(projectRoot, {recursive: true})
  writeFileSync(join(projectRoot, "package.json"), JSON.stringify({name: "@fixture/project", workspaces: ["packages/*"]}))
  for (const id of packages) {
    const packageRoot = join(projectRoot, "packages", id)
    mkdirSync(packageRoot, {recursive: true})
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({name: `@fixture/${id}`, label: id.toUpperCase()}))
    writeFileSync(join(packageRoot, "index.ts"), `/**\n# ${id.toUpperCase()}\n@packageDocumentation\n*/\n`)
  }
  return {root, projectRoot, aMetadata: join(projectRoot, "packages/a/package.json")}
}

function unexpectedBrowserAction(): never { throw new Error("Isolation test must not control a real browser") }

function activate(running: ExternalStorybookRunningServer, packageId: string): void {
  const session = running.sessions.session(packageId)
  const revision = session.snapshot().builtRevision
  if (revision === null || revision === undefined) throw new Error(`Package is not built: ${packageId}`)
  const activation = session.beginActivation({revision, viewId: `test:${packageId}`, route: ""})
  session.acknowledgeActivation({...activation, frameSequence: 1})
}

type SocketEvent = Readonly<Record<string, any> & {type: string}>
async function packageSocket(origin: string, packageId: string) {
  const page = await fetch(new URL(storybookPackageUrlPath(packageId, ""), origin))
  expect(page.status).toBe(200)
  const targetSource = (await page.text()).match(/<script type="application\/json" id="external-storybook-page-target">([^<]*)<\/script>/u)?.[1]
  if (targetSource === undefined) throw new Error("Missing package page target")
  const target = JSON.parse(targetSource) as {kind?: string; packageId?: string; readerToken?: string}
  if (target.packageId !== packageId || typeof target.readerToken !== "string") {
    throw new Error(`Invalid package page target: ${packageId}`)
  }
  const token = target.readerToken
  const url = new URL(`/api/events?session=${encodeURIComponent(token)}`, origin)
  url.protocol = "ws:"
  const Constructor = WebSocket as unknown as new (url: string, options: Readonly<{headers: Readonly<Record<string, string>>}>) => WebSocket
  const socket = new Constructor(url.href, {headers: {Origin: origin}})
  const messages: SocketEvent[] = []
  await new Promise<void>((resolvePromise, reject) => {
    socket.addEventListener("open", () => resolvePromise(), {once: true})
    socket.addEventListener("error", () => reject(new Error("WebSocket failed")), {once: true})
  })
  socket.addEventListener("message", event => { messages.push(JSON.parse(String(event.data))) })
  try {
    socket.send(JSON.stringify({type: "subscribe", topic: `package:${packageId}`}))
    await waitFor(() => messages.some(event => event.type === "subscribed" || event.type === "subscription.failed"))
    const failed = messages.find(event => event.type === "subscription.failed")
    if (failed !== undefined) throw new Error(`Package subscription failed: ${String(failed.message)}`)
  } catch (error) {
    socket.close()
    throw error
  }
  return {messages, clear() { messages.splice(0) }, close() { socket.close() },
    async waitFor(type: string) { await waitFor(() => messages.some(event => event.type === type)); return messages.find(event => event.type === type)! }}
}

async function waitFor(predicate: () => boolean, timeoutMs = 40_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(25)
  }
  throw new Error("Timed out waiting for Storybook isolation state")
}
