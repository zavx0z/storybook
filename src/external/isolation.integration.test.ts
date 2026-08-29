import {afterEach, describe, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {startExternalStorybookServer, type ExternalStorybookRunningServer} from "./server.ts"

const roots: string[] = []
const servers: ExternalStorybookRunningServer[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop()
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("one-server package isolation", () => {
  test("isolates A/B/C updates, last-good failures and shared dependencies", async () => {
    const fixture = createIsolationFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.projectRoot],
      statePath: join(fixture.root, "state", "server.json"),
      artifactRoot: join(fixture.root, "artifacts"),
    })
    servers.push(running)
    const aSocket = await packageSocket(running.origin, "@fixture/a")
    const bSocket = await packageSocket(running.origin, "@fixture/b")

    const [aPage, bPage] = await Promise.all([
      fetch(new URL("/packages/%40fixture%2Fa/catalog/a/default", running.origin)),
      fetch(new URL("/packages/%40fixture%2Fb/catalog/b/default", running.origin)),
    ])
    expect(aPage.status).toBe(200)
    expect(bPage.status).toBe(200)
    const initialA = running.sessions.session("@fixture/a").snapshot()
    const initialB = running.sessions.session("@fixture/b").snapshot()
    expect(initialA.buildState, JSON.stringify(initialA.diagnostics)).toBe("ready")
    expect(initialB.buildState, JSON.stringify(initialB.diagnostics)).toBe("ready")
    expect(initialA.subscribers).toBe(1)
    expect(initialB.subscribers).toBe(1)
    expect(running.sessions.session("@fixture/c").snapshot().builds).toBe(0)
    aSocket.clear()
    bSocket.clear()

    writeFileSync(fixture.aStory, storySource("A2", "../../../shared.ts"))
    await waitFor(() => {
      const snapshot = running.sessions.session("@fixture/a").snapshot()
      return snapshot.builds >= 2 && snapshot.buildState === "ready" &&
        snapshot.activeRevision !== initialA.activeRevision
    })
    const updatedA = running.sessions.session("@fixture/a").snapshot()
    expect(updatedA.activeRevision).not.toBe(initialA.activeRevision)
    expect(running.sessions.session("@fixture/b").snapshot().activeRevision).toBe(initialB.activeRevision)
    expect(running.sessions.session("@fixture/c").snapshot().builds).toBe(0)
    expect(await aSocket.waitFor("package.updated")).toMatchObject({packageId: "@fixture/a"})
    expect(bSocket.messages.some(({type}) => type === "package.updated")).toBeFalse()

    const lastGood = updatedA.lastGoodRevision
    aSocket.clear()
    writeFileSync(fixture.aStory, "export const story = {\n")
    await waitFor(() => running.sessions.session("@fixture/a").snapshot().buildState === "failed")
    const failedA = running.sessions.session("@fixture/a").snapshot()
    expect(failedA.activeRevision).toBe(updatedA.activeRevision)
    expect(failedA.lastGoodRevision).toBe(lastGood)
    expect(failedA.diagnostics.length).toBeGreaterThan(0)
    expect(running.sessions.session("@fixture/b").snapshot().buildState).toBe("ready")
    expect(await aSocket.waitFor("package.failed")).toMatchObject({packageId: "@fixture/a"})

    aSocket.clear()
    writeFileSync(fixture.aStory, storySource("A3", "../../../shared.ts"))
    await waitFor(() => {
      const snapshot = running.sessions.session("@fixture/a").snapshot()
      return snapshot.buildState === "ready" && snapshot.activeRevision !== updatedA.activeRevision
    })
    expect(running.sessions.session("@fixture/a").snapshot().diagnostics).toEqual([])
    expect(await aSocket.waitFor("package.updated")).toMatchObject({packageId: "@fixture/a"})

    aSocket.clear()
    bSocket.clear()
    const beforeSharedA = running.sessions.session("@fixture/a").snapshot().builds
    const beforeSharedB = running.sessions.session("@fixture/b").snapshot().builds
    writeFileSync(fixture.shared, "export const shared = 'shared-2'\n")
    await waitFor(() =>
      running.sessions.session("@fixture/a").snapshot().builds > beforeSharedA &&
      running.sessions.session("@fixture/b").snapshot().builds > beforeSharedB)
    expect(await aSocket.waitFor("package.updated")).toMatchObject({packageId: "@fixture/a"})
    expect(await bSocket.waitFor("package.updated")).toMatchObject({packageId: "@fixture/b"})
    expect(running.sessions.session("@fixture/c").snapshot().builds).toBe(0)

    const beforeShellA = running.sessions.session("@fixture/a").snapshot().builds
    const beforeShellB = running.sessions.session("@fixture/b").snapshot().builds
    const sharedShell = realpathSync(join(import.meta.dir, "browser", "package-entry.ts"))
    expect(running.sessions.notifyDependency(sharedShell)).toBe(2)
    await waitFor(() =>
      running.sessions.session("@fixture/a").snapshot().builds > beforeShellA &&
      running.sessions.session("@fixture/b").snapshot().builds > beforeShellB)
    expect(running.sessions.session("@fixture/c").snapshot().builds).toBe(0)
    expect((await fetch(new URL("/api/health", running.origin))).status).toBe(200)
    aSocket.close()
    bSocket.close()
  }, 20_000)
})

type SocketEvent = Readonly<Record<string, any> & {type: string}>

async function packageSocket(origin: string, packageId: string) {
  const url = new URL("/api/events", origin)
  url.protocol = "ws:"
  const socket = new WebSocket(url.href)
  const messages: SocketEvent[] = []
  await new Promise<void>((resolvePromise, reject) => {
    socket.addEventListener("open", () => resolvePromise(), {once: true})
    socket.addEventListener("error", () => reject(new Error("Storybook test WebSocket failed")), {once: true})
  })
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return
    const value = JSON.parse(event.data) as SocketEvent
    messages.push(value)
  })
  socket.send(JSON.stringify({type: "subscribe", topic: `package:${packageId}`}))
  await waitFor(() => messages.some(({type}) => type === "subscribed"))
  return {
    messages,
    clear() {
      messages.splice(0)
    },
    async waitFor(type: string): Promise<SocketEvent> {
      await waitFor(() => messages.some((event) => event.type === type))
      return messages.find((event) => event.type === type)!
    },
    close() {
      socket.close()
    },
  }
}

function createIsolationFixture() {
  const root = mkdtempSync(join(tmpdir(), "storybook-isolation-"))
  roots.push(root)
  const projectRoot = join(root, "project")
  mkdirSync(join(projectRoot, ".storybook"), {recursive: true})
  writeFileSync(join(projectRoot, "package.json"), JSON.stringify({name: "@fixture/project", private: true}))
  const shared = join(projectRoot, "shared.ts")
  writeFileSync(shared, "export const shared = 'shared-1'\n")
  const packages = ["a", "b", "c"] as const
  writeFileSync(join(projectRoot, ".storybook", "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    kind: "project",
    id: "fixture-isolation",
    label: "Fixture Isolation",
    packages: packages.map((id) => ({declaration: `../packages/${id}/.storybook/manifest.json`})),
  }, null, 2)}\n`)
  const stories = new Map<string, string>()
  for (const id of packages) {
    const packageRoot = join(projectRoot, "packages", id)
    const declarationRoot = join(packageRoot, ".storybook")
    mkdirSync(declarationRoot, {recursive: true})
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
      name: `@fixture/${id}`,
      private: true,
      type: "module",
    }))
    writeFileSync(join(declarationRoot, "manifest.json"), `${JSON.stringify({
      schemaVersion: 1,
      kind: "package",
      id: `@fixture/${id}`,
      label: `Fixture ${id.toUpperCase()}`,
      packageJson: "../package.json",
      runtime: {module: "./runtime.ts", export: "runtime"},
      catalog: "./catalog.json",
    }, null, 2)}\n`)
    writeFileSync(join(declarationRoot, "catalog.json"), `${JSON.stringify({
      schemaVersion: 1,
      categories: [{
        id: "catalog",
        label: "Catalog",
        subjects: [{
          id,
          kind: "fixture",
          label: id.toUpperCase(),
          variants: [{
            id: "default",
            label: "Default",
            route: `catalog/${id}/default`,
            module: {path: "./story.ts", export: "story"},
          }],
        }],
      }],
    }, null, 2)}\n`)
    writeFileSync(join(declarationRoot, "runtime.ts"), [
      "export const runtime = Object.freeze({",
      "  protocol: 'storybook-runtime/1',",
      "  create() {",
      "    return Object.freeze({mount() {}, unmount() {}, dispose() {}})",
      "  },",
      "})",
      "",
    ].join("\n"))
    const story = join(declarationRoot, "story.ts")
    writeFileSync(story, id === "c"
      ? "export const story = 'C'\n"
      : storySource(id.toUpperCase(), "../../../shared.ts"))
    stories.set(id, story)
  }
  return {
    root,
    projectRoot,
    shared,
    aStory: stories.get("a")!,
  }
}

function storySource(label: string, sharedPath: string): string {
  return [
    `import {shared} from ${JSON.stringify(sharedPath)}`,
    `export const story = ${JSON.stringify(label)} + shared`,
    "",
  ].join("\n")
}

async function waitFor(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(25)
  }
  throw new Error("Timed out waiting for Storybook isolation state")
}
