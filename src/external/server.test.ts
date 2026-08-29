import {afterEach, describe, expect, test} from "bun:test"
import {existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {startExternalStorybookServer, type ExternalStorybookRunningServer} from "./server.ts"
import {writeExternalStorybookServerRecord} from "./server-state.ts"

const roots: string[] = []
const servers: ExternalStorybookRunningServer[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop()
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("one external Storybook server", () => {
  test("serves the shared landing bundle and a lazily built documentation package on one origin", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.standalone],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const landing = await fetch(new URL("/", running.origin))
    expect(landing.status).toBe(200)
    const html = await landing.text()
    const script = html.match(/<script type="module" src="([^"]+)"/u)?.[1]
    expect(script).toBeDefined()
    expect((await fetch(new URL(script!, running.origin))).status).toBe(200)

    const packagePage = await fetch(new URL("/packages/%40fixture%2Fstandalone/", running.origin))
    expect(packagePage.status).toBe(200)
    const state = running.sessions.session("@fixture/standalone").snapshot()
    expect(state.buildState).toBe("ready")
    expect(state.activeRevision).not.toBeNull()
    expect(new URL(packagePage.url).origin).toBe(running.origin)
    const checked = await postJson(running.origin, "/api/check", {scope: "@fixture/standalone"})
    expect(checked.response.status).toBe(200)
    expect(running.sessions.session("@fixture/standalone").snapshot().builds).toBe(1)
  })

  test("owns one automatic origin and atomically attaches independent roots", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      landingEntryPath: fixture.landingEntry,
      fallbackEntryPath: fixture.fallbackEntry,
      packageBrowserEntryPath: fixture.packageEntry,
    })
    servers.push(running)
    const health = await fetchJson(new URL("/api/health", running.origin))
    expect(health.ok).toBeTrue()
    expect(health.origin).toBe(running.origin)

    const first = await postJson(running.origin, "/api/attach", {path: fixture.workspace})
    expect(first.response.status).toBe(200)
    const second = await postJson(running.origin, "/api/attach", {path: fixture.standalone})
    expect(second.response.status).toBe(200)
    const client = await fetchJson(new URL("/api/client", running.origin))
    expect(client.rootIds).toEqual([
      "workspace:fixture-workspace",
      "package:@fixture/standalone",
    ])
    expect(client.packages).toHaveLength(3)
    expect(new Set(client.nodes.map((node: {urlPath: string}) => new URL(node.urlPath, running.origin).origin)))
      .toEqual(new Set([running.origin]))
    const variant = client.nodes.find((node: {id: string}) =>
      node.id === "variant:@fixture/components/components/button/contained")
    const reference = await fetch(new URL(`${variant.resourceUrl}?kind=reference&index=0`, running.origin))
    expect(reference.status).toBe(200)
    expect(await reference.text()).toContain("button-contained")
  })

  test("builds only the requested executable package revision", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.workspace],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const components = await fetch(new URL(
      "/packages/%40fixture%2Fcomponents/components/button/basic/contained",
      running.origin,
    ))
    expect(components.status).toBe(200)
    const componentState = running.sessions.session("@fixture/components").snapshot()
    expect(componentState.buildState, JSON.stringify(componentState.diagnostics)).toBe("ready")
    expect(running.sessions.session("@fixture/docs").snapshot().builds).toBe(0)
  })

  test("failed attach leaves registry and sessions unchanged", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.workspace],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      landingEntryPath: fixture.landingEntry,
      fallbackEntryPath: fixture.fallbackEntry,
      packageBrowserEntryPath: fixture.packageEntry,
    })
    servers.push(running)
    const before = await fetchJson(new URL("/api/status", running.origin))
    const failed = await postJson(running.origin, "/api/attach", {path: join(fixture.root, "missing")})
    expect(failed.response.status).toBe(404)
    const after = await fetchJson(new URL("/api/status", running.origin))
    expect(after.graphDigest).toBe(before.graphDigest)
    expect(after.entries).toEqual(before.entries)
    expect(after.packages).toEqual(before.packages)
  })

  test("rolls back graph, sessions and state when post-validation publication fails", async () => {
    const fixture = serverFixture()
    let writes = 0
    const running = await startExternalStorybookServer({
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      writeServerRecord(path, record) {
        writes += 1
        if (writes === 2) throw new Error("injected state publication failure")
        writeExternalStorybookServerRecord(path, record)
      },
    })
    servers.push(running)
    const before = running.registry.snapshot()
    const failed = await postJson(running.origin, "/api/attach", {path: fixture.workspace})
    expect(failed.response.status).toBe(400)
    expect(running.registry.snapshot().revision).toBe(before.revision)
    expect(running.registry.snapshot().graph).toBe(before.graph)
    expect(running.sessions.snapshots()).toEqual([])
    expect((await fetchJson(new URL("/api/status", running.origin))).entries).toEqual([])
  })

  test("fails closed when an attached README is replaced by an escaping symlink", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.workspace],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const readme = join(fixture.workspace, "projects/alpha/README.md")
    const outside = join(fixture.root, "outside-secret.md")
    writeFileSync(outside, "outside secret\n")
    unlinkSync(readme)
    symlinkSync(outside, readme)
    const client = await fetchJson(new URL("/api/client", running.origin))
    const project = client.nodes.find((node: {id: string}) => node.id === "project:fixture-alpha")
    const response = await fetch(new URL(project.resourceUrl, running.origin))
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain("outside secret")
  })

  test("shows an isolated shared shell when a package has no last-good revision", async () => {
    const fixture = serverFixture()
    const storyDirectory = join(
      fixture.workspace,
      "projects/alpha/packages/components/.storybook/stories",
    )
    writeFileSync(join(storyDirectory, "broken.ts"), "export const broken = {\n")
    writeFileSync(join(storyDirectory, "button.ts"), [
      'import {broken} from "./broken.ts"',
      "export const contained = broken",
      "export const outlined = broken",
      "",
    ].join("\n"))
    const running = await startExternalStorybookServer({
      declarations: [fixture.workspace],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const page = await fetch(new URL(
      "/packages/%40fixture%2Fcomponents/components/button/basic/contained",
      running.origin,
    ))
    expect(page.status).toBe(200)
    expect(await page.text()).toContain("/__storybook/shared/fallback-entry-")
    const failed = running.sessions.session("@fixture/components").snapshot()
    expect(failed.buildState).toBe("failed")
    expect(failed.activeRevision).toBeNull()
    expect(failed.lastGoodRevision).toBeNull()
    expect(running.sessions.session("@fixture/docs").snapshot().builds).toBe(0)
    expect((await fetch(new URL("/api/health", running.origin))).status).toBe(200)
  })

  test("delivers CLI open to the landing topic with one named package URL", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.standalone],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const url = new URL("/api/events", running.origin)
    url.protocol = "ws:"
    const socket = new WebSocket(url.href)
    const messages: Array<Record<string, unknown>> = []
    await new Promise<void>((resolvePromise) => socket.addEventListener("open", () => resolvePromise(), {once: true}))
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") messages.push(JSON.parse(event.data))
    })
    socket.send(JSON.stringify({type: "subscribe", topic: "registry"}))
    await waitFor(() => messages.some(({type}) => type === "subscribed"))
    const opened = await postJson(running.origin, "/api/open", {
      packageId: "@fixture/standalone",
      route: "",
    })
    expect(opened.body.delivered).toBe(1)
    await waitFor(() => messages.some(({type}) => type === "package.open"))
    expect(messages.find(({type}) => type === "package.open")).toMatchObject({
      packageId: "@fixture/standalone",
      urlPath: "/packages/%40fixture%2Fstandalone/",
    })
    socket.close()
  })

  test("detach keeps the shared server alive and stop removes only owned state", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.workspace, fixture.standalone],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      landingEntryPath: fixture.landingEntry,
      fallbackEntryPath: fixture.fallbackEntry,
      packageBrowserEntryPath: fixture.packageEntry,
    })
    servers.push(running)
    const detached = await postJson(running.origin, "/api/detach", {scopeId: "fixture-workspace"})
    expect(detached.response.status).toBe(200)
    expect((await fetchJson(new URL("/api/health", running.origin))).ok).toBeTrue()
    expect(running.sessions.snapshots().map(({packageId}) => packageId)).toEqual([
      "@fixture/standalone",
    ])
    expect(existsSync(fixture.statePath)).toBeTrue()
    const stopped = await postJson(running.origin, "/api/stop", {})
    expect(stopped.response.status).toBe(200)
    await running.stopped
    expect(existsSync(fixture.statePath)).toBeFalse()
    servers.splice(servers.indexOf(running), 1)
  })
})

function serverFixture(): Readonly<{
  root: string
  workspace: string
  standalone: string
  statePath: string
  artifactRoot: string
  landingEntry: string
  fallbackEntry: string
  packageEntry: string
}> {
  const root = mkdtempSync(join(tmpdir(), "external-storybook-server-test-"))
  roots.push(root)
  const source = join(import.meta.dir, "fixtures", "valid")
  const workspace = join(root, "workspace")
  mkdirSync(workspace, {recursive: true})
  Bun.spawnSync(["cp", "-R", `${source}/.`, workspace])
  const entries = join(root, "entries")
  mkdirSync(entries, {recursive: true})
  const landingEntry = join(entries, "landing-entry.ts")
  const fallbackEntry = join(entries, "fallback-entry.ts")
  const packageEntry = join(entries, "package-entry.ts")
  writeFileSync(landingEntry, "document.documentElement.dataset.fixtureLanding = 'ready'\n")
  writeFileSync(fallbackEntry, "document.documentElement.dataset.fixtureFallback = 'ready'\n")
  writeFileSync(packageEntry, "export async function startExternalStorybookPackage() {}\n")
  return Object.freeze({
    root,
    workspace,
    standalone: join(workspace, "standalone"),
    statePath: join(root, "state", "server.json"),
    artifactRoot: join(root, "artifacts"),
    landingEntry,
    fallbackEntry,
    packageEntry,
  })
}

async function fetchJson(url: URL): Promise<any> {
  const response = await fetch(url)
  expect(response.status).toBe(200)
  return response.json()
}

async function postJson(origin: string, path: string, body: unknown) {
  const response = await fetch(new URL(path, origin), {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(body),
  })
  return {response, body: await response.json()}
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(20)
  }
  throw new Error("Timed out waiting for Storybook server event")
}
