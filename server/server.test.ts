import {afterEach, describe, expect, setDefaultTimeout, spyOn, test} from "bun:test"
import * as filesystem from "node:fs"
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import type {StorybookBrowserLifecycle} from "@zavx0z/storybook-browser-lifecycle/service"
import {
  startExternalStorybookServer,
  StorybookBrowserSessionRegistry,
  type ExternalStorybookRunningServer,
} from "./server.ts"
import {writeExternalStorybookServerRecord} from "./server-state.ts"

const roots: string[] = []
const servers: ExternalStorybookRunningServer[] = []
setDefaultTimeout(120_000)

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()))
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("one external Storybook server", () => {
  test("корневой REST возвращает два раздела без сборки", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.standalone],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const url = new URL("/api/control/storybook", running.origin)
    const unauthorized = await fetch(url)
    expect(unauthorized.status).toBe(401)
    const response = await fetch(url, {
      method: "POST",
      headers: {authorization: `Bearer ${running.record.controlToken}`, "content-type": "application/json"},
      body: "{}",
    })
    const value = await response.json() as {children: {id: string}[]}
    expect(value.children.map(node => node.id)).toEqual(["archetypes", "validator"])
    expect(running.sessions.snapshots().every(item => item.builds === 0)).toBe(true)
  })

  test("shared worker восстанавливает проверенные ресурсы после перезапуска без компиляции", async () => {
    const fixture = serverFixture()
    const options = {
      declarations: [fixture.standalone],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      landingEntryPath: join(import.meta.dir, "fixtures/shared-landing.ts"),
      fallbackEntryPath: join(import.meta.dir, "fixtures/shared-fallback.ts"),
    }
    let running = await startExternalStorybookServer(options)
    servers.push(running)
    const first = await fetch(new URL("/", running.origin))
    const firstHtml = await first.text()
    expect(first.status).toBe(200)
    expect(firstHtml).toContain('<script type="module"')
    expect(firstHtml).toContain("/__storybook/shared/styles/")
    expect(running.sessions.buildSchedulerSnapshot().recent.at(-1)?.cache).toEqual({status: "miss", layer: "shared"})
    await running.stop()
    servers.splice(servers.indexOf(running), 1)
    running = await startExternalStorybookServer(options)
    servers.push(running)
    const second = await fetch(new URL("/", running.origin))
    expect(second.status).toBe(200)
    expect(await second.text()).toContain('<script type="module"')
    expect(running.sessions.buildSchedulerSnapshot().recent).toEqual([])
    expect(running.sessions.snapshots().every(item => item.builds === 0)).toBe(true)
    const fallback = await fetch(new URL("/pkg-fixture-standalone/?inspector=source", running.origin))
    expect(fallback.status).toBe(200)
    const packageHtml = await fallback.text()
    expect(packageHtml).toContain('<script type="module"')
    expect(packageHtml).toContain('"intent":"navigation-candidate"')
    expect(running.sessions.buildSchedulerSnapshot().recent.filter(item => item.owner === "shared")).toEqual([])
    expect(running.sessions.session("@fixture/standalone").snapshot().builds).toBe(1)
    expect(running.sessions.session("@fixture/standalone").snapshot().activeRevision).toBeNull()
    await running.stop()
    servers.splice(servers.indexOf(running), 1)
    const receipt = JSON.parse(readFileSync(join(fixture.artifactRoot, "shared/receipt.json"), "utf8"))
    writeFileSync(join(fixture.artifactRoot, "shared", receipt.assets.landingEntry), "damaged output")
    running = await startExternalStorybookServer(options)
    servers.push(running)
    expect(await (await fetch(new URL("/", running.origin))).text()).toContain('<script type="module"')
    expect(running.sessions.buildSchedulerSnapshot().recent.at(-1)?.cache.status).toBe("miss")
  }, 120_000)

  test("status показывает preflight и нагрузку, не запрашивая сборку", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.standalone],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const before = running.registry.metrics()
    const response = await fetch(new URL("/api/control/status?scope=%40fixture%2Fstandalone", running.origin), {
      headers: {authorization: `Bearer ${running.record.controlToken}`},
    })
    expect(response.status).toBe(200)
    const value = await response.json() as Record<string, any>
    expect(value.preflight.packageIds).toEqual(["@fixture/standalone"])
    expect(value.buildScheduler).toMatchObject({activeCount: 0, queuedCount: 0})
    expect(value.packages.every((item: {builds: number}) => item.builds === 0)).toBe(true)
    expect(value.discovery.resolverCalls).toBe(before.resolverCalls)
    expect(value.dependencyWatch.paths).toBeGreaterThan(0)
    expect(JSON.stringify(value.buildScheduler)).not.toContain('"pid"')
  })

  test("сообщает этапы запуска в порядке подготовки каталога и публикации сервера", async () => {
    const fixture = serverFixture()
    const phases: string[] = []
    const running = await startExternalStorybookServer({
      declarations: [fixture.standalone],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      onStartupPhase: phase => phases.push(phase),
    })
    servers.push(running)
    expect(phases).toEqual(["catalog", "sessions", "listen", "publication", "ready"])
    expect(existsSync(fixture.statePath)).toBe(true)
  })

  test("shares saved project selection between browser and MCP including nested removal and an empty restart", async () => {
    const fixture = serverFixture()
    const options = {declarations: [fixture.workspace], projectDirectory: fixture.workspace, statePath: fixture.statePath, artifactRoot: fixture.artifactRoot}
    let running = await startExternalStorybookServer(options)
    servers.push(running)
    const workspaceFile = join(fixture.workspace, ".storybook/manifest.json")
    const workspaceBytes = readFileSync(workspaceFile, "utf8")
    const html = await (await fetch(new URL("/", running.origin))).text()
    const session = html.match(/name="external-storybook-browser-session" content="([^"]+)"/u)?.[1]
    expect(session).toBeDefined()
    const browserChange = (action: string, body: unknown, origin = running.origin) => fetch(new URL(`/api/browser/${action}`, running.origin), {
      method: "POST",
      headers: {"content-type": "application/json", "origin": origin, "x-storybook-session": session!},
      body: JSON.stringify(body),
    })

    const browserAttach = async (root: string) => {
      const challenge = await (await browserChange("directory", {})).json() as {token: string; filename: string; content: string}
      const marker = join(root, challenge.filename)
      writeFileSync(marker, challenge.content)
      try { return await browserChange("attach", {selectionToken: challenge.token}) }
      finally { unlinkSync(marker) }
    }
    expect((await browserChange("attach", {selectionToken: "foreign"}, "https://foreign.invalid")).ok).toBeFalse()
    expect(running.registry.snapshot().entries).toHaveLength(1)
    expect((await browserAttach(fixture.standalone)).ok).toBeTrue()
    expect((await browserAttach(fixture.standalone)).ok).toBeTrue()
    expect(running.registry.snapshot().entries).toHaveLength(2)
    const beforeFailure = running.registry.snapshot()
    expect((await browserChange("attach", {selectionToken: "missing"})).ok).toBeFalse()
    expect(running.registry.snapshot()).toEqual(beforeFailure)

    const removed = await controlPost(running, "/api/control/detach", {scopeId: "package:fixture-alpha"})
    expect(removed.response.ok).toBeTrue()
    expect(running.registry.snapshot().graph.nodes.some(node => node.id === "package:fixture-alpha")).toBeFalse()
    expect(running.registry.snapshot().graph.nodes.some(node => node.id === "package:fixture-beta")).toBeTrue()
    expect(readFileSync(workspaceFile, "utf8")).toBe(workspaceBytes)
    expect((await browserAttach(join(fixture.workspace, "projects/alpha"))).ok).toBeTrue()
    expect(running.registry.snapshot().entries).toHaveLength(3)
    await controlPost(running, "/api/control/detach", {scopeId: "package:fixture-alpha"})
    await running.stop()

    running = await startExternalStorybookServer(options)
    servers.push(running)
    expect(running.registry.snapshot().entries).toHaveLength(2)
    expect(running.registry.snapshot().graph.nodes.some(node => node.id === "package:fixture-alpha")).toBeFalse()
    expect(running.registry.snapshot().graph.nodes.some(node => node.id === "package:fixture-beta")).toBeTrue()
    const restored = await controlPost(running, "/api/control/attach", {roots: [join(fixture.workspace, "projects/alpha")]})
    expect(restored.response.ok).toBeTrue()
    expect(running.registry.snapshot().entries).toHaveLength(3)
    expect(running.registry.snapshot().graph.nodes.some(node => node.id === "package:fixture-alpha")).toBeTrue()

    await controlPost(running, "/api/control/detach", {scopeId: "package:fixture-alpha"})
    await controlPost(running, "/api/control/detach", {scopeId: "package:fixture-beta"})
    await controlPost(running, "/api/control/detach", {scopeId: "package:@fixture/standalone"})
    await running.stop()
    running = await startExternalStorybookServer(options)
    servers.push(running)
    expect(running.registry.snapshot().entries).toEqual([])
    const empty = await fetch(new URL("/", running.origin))
    expect(empty.status).toBe(200)
    expect(await empty.text()).toContain('/assets/workbench-style/0.css')
    const theme = await fetch(new URL("/assets/workbench-style/0.css", running.origin))
    expect(theme.status).toBe(200)
    expect(await theme.text()).toContain("--widget-")
    expect(readFileSync(workspaceFile, "utf8")).toBe(workspaceBytes)
  })

  test("serves a project page when a peer registered a dependency before its hardlink spelling changed", async () => {
    const fixture = serverFixture()
    const entries = sharedEntriesFixture()
    const dependency = join(entries.root, "shared.ts")
    const mirror = join(entries.root, "shared-mirror.ts")
    writeFileSync(dependency, 'export const title = "project"\n')
    filesystem.linkSync(dependency, mirror)
    writeFileSync(entries.landing, 'import {title} from "./shared.ts"\ndocument.title = title\n')
    const running = await startExternalStorybookServer({
      declarations: [fixture.workspace],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      landingEntryPath: entries.landing,
      fallbackEntryPath: entries.fallback,
    })
    servers.push(running)
    const original = filesystem.realpathSync
    let reported = mirror
    const resolution = spyOn(filesystem, "realpathSync").mockImplementation(new Proxy(original, {
      apply(target, receiver, args) {
        const actual = Reflect.apply(target, receiver, args)
        if (String(args[0]) !== dependency) return actual
        return typeof actual === "string" ? reported : Buffer.from(reported)
      },
    }))
    Object.defineProperty(resolution, "native", {value: original.native})
    try {
      running.watch.replace("@fixture/peer", [dependency], () => {})
      reported = dependency
      const response = await fetch(new URL("/projects/fixture-alpha/", running.origin))
      const html = await response.text()
      expect(response.status, html).toBe(200)
      expect(html).toContain('<script type="module"')
      expect(html).not.toContain("dependency alias resolves ambiguously")
      expect(running.watch.notify(dependency)).toBe(2)
    } finally {
      resolution.mockRestore()
    }
  })

  test("keeps active browser leases alive and releases pending eviction", () => {
    let now = 0
    let released = 0
    const registry = new StorybookBrowserSessionRegistry({ttlMs: 10, maxEntries: 1, now: () => now})
    registry.issue({kind: "package", packageId: "@fixture/a", revision: "one", release: () => { released += 1 }})
    const second = registry.issue({
      kind: "package", packageId: "@fixture/b", revision: "two", release: () => { released += 1 },
    })
    expect(released).toBe(1)
    registry.consume(second.token)
    now = 100
    expect(registry.authorize(second.token).revision).toBe("two")
    registry.release(second.token)
    expect(released).toBe(2)
  })

  test("keeps active landing authority independent from the event socket TTL", () => {
    let now = 0
    const registry = new StorybookBrowserSessionRegistry({ttlMs: 100, now: () => now})
    const issued = registry.issue({kind: "registry", packageId: null, revision: null})
    registry.consume(issued.token)
    now = 10_000
    expect(registry.authorize(issued.token).kind).toBe("registry")
  })

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
    expect(html).toContain('<link rel="icon" href="data:,">')
    expect(html).toContain('<meta name="engine-default-font" content="/assets/inter-regular.ttf">')
    expect(html).not.toContain("jetbrains-mono-bold.ttf")
    expect(html).toContain("<title>Storybook</title>")
    expect(html).not.toContain("<title>MetaFor</title>")
    const fontAsset = await fetch(new URL("/assets/inter-regular.ttf", running.origin))
    expect(fontAsset.status).toBe(200)
    expect(fontAsset.headers.get("content-type")).toBe("font/ttf")
    expect(Buffer.from(await fontAsset.arrayBuffer())).toEqual(readFileSync(fileURLToPath(
      import.meta.resolve("@zavx0z/engine/fonts/inter-regular.ttf"),
    )))
    const script = html.match(/<script type="module" src="([^"]+)"/u)?.[1]
    expect(script).toBeDefined()
    expect((await fetch(new URL(script!, running.origin))).status).toBe(200)

    const packagePage = await fetch(new URL("/pkg-fixture-standalone/", running.origin))
    expect(packagePage.status).toBe(200)
    const packageHtml = await packagePage.text()
    expect(packageHtml).toContain("<title>Standalone Fixture</title>")
    expect(packageHtml).not.toContain("· Storybook</title>")
    const state = running.sessions.session("@fixture/standalone").snapshot()
    expect(state.buildState).toBe("built")
    expect(state.builtRevision).not.toBeNull()
    expect(state.activeRevision).toBeNull()
    const revisionReadme = await fetch(new URL(
      `/__storybook/revisions/%40fixture%2Fstandalone/${state.builtRevision}/resources/nodes/${
        encodeURIComponent("package:@fixture/standalone")
      }/readme.md`,
      running.origin,
    ))
    expect(revisionReadme.status).toBe(200)
    expect(await revisionReadme.text()).toContain("Standalone")
    expect(new URL(packagePage.url).origin).toBe(running.origin)
    const checked = await controlPost(running, "/api/control/check", {scope: "@fixture/standalone"})
    expect(checked.response.status).toBe(200)
    expect(running.sessions.session("@fixture/standalone").snapshot().builds).toBe(1)
  }, 120_000)

  test("refreshes shared dependencies on the same server and keeps old hashed assets available", async () => {
    const fixture = serverFixture()
    const entries = sharedEntriesFixture()
    const dependency = join(entries.root, "code-view.ts")
    writeFileSync(dependency, 'export const height = "160px"\n')
    writeFileSync(entries.landing, 'import {height} from "./code-view.ts"\ndocument.title = height\n')
    const running = await startExternalStorybookServer({
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      landingEntryPath: entries.landing,
      fallbackEntryPath: entries.fallback,
    })
    servers.push(running)
    const instance = running.record.instanceId
    const entry = async () => {
      const response = await fetch(new URL("/", running.origin))
      const html = await response.text()
      expect(response.status, html).toBe(200)
      const script = html.match(/<script type="module" src="([^"]+)"/u)?.[1]
      if (script === undefined) throw new Error("Missing landing entry")
      return script
    }
    const first = await entry()
    const original = await (await fetch(new URL(first, running.origin))).text()
    expect(original).toContain("160px")
    writeFileSync(dependency, 'export const height = "auto"\n')
    const second = await entry()
    expect(second).not.toBe(first)
    expect(await (await fetch(new URL(second, running.origin))).text()).toContain("auto")
    expect(await (await fetch(new URL(first, running.origin))).text()).toBe(original)
    writeFileSync(dependency, "export const height =\n")
    expect(await entry()).toBe(second)
    writeFileSync(dependency, 'export const height = "content"\n')
    const repaired = await entry()
    expect(repaired).not.toBe(second)
    expect(await (await fetch(new URL(repaired, running.origin))).text()).toContain("content")
    expect(running.record.instanceId).toBe(instance)
    expect((await fetch(new URL("/api/health", running.origin))).status).toBe(200)
  })

  test("notifies a root package README change without rebuilding children or changing the server", async () => {
    const fixture = serverFixture()
    const entries = sharedEntriesFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.workspace],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      landingEntryPath: entries.landing,
      fallbackEntryPath: entries.fallback,
    })
    servers.push(running)
    const page = await fetch(new URL("/projects/fixture-alpha/", running.origin))
    const html = await page.text()
    expect(page.status, html).toBe(200)
    const url = new URL(`/api/events?session=${encodeURIComponent(browserSessionToken(html))}`, running.origin)
    url.protocol = "ws:"
    const socket = storybookSocket(url.href, running.origin)
    const messages: Array<Record<string, unknown>> = []
    socket.addEventListener("message", event => { messages.push(JSON.parse(String(event.data))) })
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), {once: true})
      socket.addEventListener("error", () => reject(new Error("README socket failed")), {once: true})
    })
    try {
      socket.send(JSON.stringify({type: "subscribe", topic: "package:fixture-alpha"}))
      await waitFor(() => messages.some(message => message.type === "subscribed"))
      socket.send(JSON.stringify({type: "subscribe", topic: "catalog"}))
      await waitFor(() => messages.some(message => message.type === "subscribed" && message.topic === "catalog"))
      await running.sessions.buildScheduler.run({
        packageId: null,
        generation: null,
        owner: "shared",
        reason: "input-changed",
      }, async context => {
        context.setPhase("bundle")
      }, new AbortController().signal)
      await waitFor(() => messages.some(message => message.type === "build.progress" && message.packageId === null && message.state === "completed"))
      expect(messages.some(message => message.type === "build.progress" && message.packageId === null && message.phase === "bundle" && message.state === "running")).toBe(true)
      const builds = running.sessions.snapshots().filter(snapshot => snapshot.packageId !== "fixture-alpha").map(snapshot => snapshot.builds)
      const instance = running.record.instanceId
      const revision = running.registry.snapshot().revision
      const readme = join(fixture.workspace, "projects/alpha/README.md")
      writeFileSync(readme, "# Updated project README\n")
      running.watch.notify(readme)
      await waitFor(() => messages.some(message => message.type === "package.metadata-updated"))
      expect(messages.find(message => message.type === "package.metadata-updated")?.packageId).toBe("fixture-alpha")
      expect(messages.some(message => message.type === "registry.updated" || message.type === "shared.updated")).toBe(false)
      expect(running.registry.snapshot().revision).toBe(revision)
      expect(running.sessions.snapshots().filter(snapshot => snapshot.packageId !== "fixture-alpha").map(snapshot => snapshot.builds)).toEqual(builds)
      expect(running.record.instanceId).toBe(instance)
    } finally {
      socket.close()
    }
  })

  test("owns one automatic origin and atomically attaches independent roots", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      landingEntryPath: fixture.landingEntry,
      fallbackEntryPath: fixture.fallbackEntry,
      packageBrowserEntryPath: fixture.packageEntry,
      browserLifecycle: fakeBrowserLifecycle().service,
    })
    servers.push(running)
    const health = await fetchJson(new URL("/api/health", running.origin))
    expect(health.ok).toBeTrue()
    expect(health.origin).toBe(running.origin)

    const first = await controlPost(running, "/api/control/attach", {roots: [fixture.workspace]})
    expect(first.response.status).toBe(200)
    const second = await controlPost(running, "/api/control/attach", {roots: [fixture.standalone]})
    expect(second.response.status).toBe(200)
    const client = await fetchJson(new URL("/api/client", running.origin))
    expect(client.rootIds).toEqual([
      "package:fixture-workspace",
      "package:@fixture/standalone",
    ])
    expect(client.packages).toHaveLength(6)
    expect(new Set(client.nodes.map((node: {urlPath: string}) => new URL(node.urlPath, running.origin).origin)))
      .toEqual(new Set([running.origin]))
    const variant = client.nodes.find((node: {id: string}) =>
      node.id === "variant:@fixture/components/components/button/contained")
    const reference = await fetch(new URL(`${variant.resourceUrl}?kind=reference&index=0`, running.origin))
    expect(reference.status).toBe(200)
    expect(await reference.text()).toContain("button-contained")
    expect(running.record.attachedDeclarations).toHaveLength(2)
    expect(running.record.controlToken).toMatch(/^[A-Za-z0-9_-]{43}$/u)
  })

  test("wires structural files and separately owned landing README watches", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.workspace],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const watched = [
      join(fixture.workspace, ".storybook/manifest.json"),
      join(fixture.workspace, "README.md"),
      join(fixture.workspace, "projects/alpha/.storybook/manifest.json"),
      join(fixture.workspace, "projects/alpha/README.md"),
      join(fixture.workspace, "projects/alpha/packages/components/.storybook/catalog.json"),
      join(fixture.workspace, "projects/alpha/packages/components/package.json"),
    ]
    for (const path of watched) {
      expect(running.watch.notify(path)).toBeGreaterThan(0)
    }
    const unrelated = join(fixture.workspace, "unrelated.txt")
    writeFileSync(unrelated, "unrelated")
    expect(running.watch.notify(unrelated)).toBe(0)
  })

  test("explicit refresh reconciles an attached declaration even when its watch event was missed", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.workspace],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const before = running.registry.snapshot()
    const packageJsonPath = join(
      fixture.workspace,
      "projects/alpha/packages/components/package.json",
    )
    const metadata = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>
    metadata.label = "Components refreshed"
    writeFileSync(packageJsonPath, `${JSON.stringify(metadata, null, 2)}\n`)

    const refreshed = await controlPost(running, "/api/control/refresh", {})
    expect(refreshed.response.status).toBe(200)
    expect(refreshed.body.registryRevision).toBeGreaterThan(before.revision)
    expect(refreshed.body.graphDigest).not.toBe(before.graph.digest)
    expect(running.registry.snapshot().graph.nodes.find(({id}) =>
      id === "package:@fixture/components")?.label).toBe("Components refreshed")

    const stableRevision = running.registry.snapshot().revision
    const unchanged = await controlPost(running, "/api/control/refresh", {})
    expect(unchanged.body.registryRevision).toBe(stableRevision)
  })

  test("user pages and browser requests cannot publish a built candidate", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({declarations: [fixture.standalone], statePath: fixture.statePath, artifactRoot: fixture.artifactRoot})
    servers.push(running)
    const page = await fetch(new URL("/pkg-fixture-standalone/", running.origin))
    const html = await page.text()
    expect(html).toContain("/__storybook/shared/")
    expect(html).not.toContain('name="external-storybook-activation-id"')
    const state = running.sessions.session("@fixture/standalone").snapshot()
    expect(state.builtRevision).not.toBeNull()
    expect(state.activeRevision).toBeNull()
    const rejected = await fetch(new URL("/api/browser/activation", running.origin), {
      method: "POST", headers: {origin: running.origin, "content-type": "application/json", "x-storybook-session": browserSessionToken(html)},
      body: JSON.stringify({packageId: "@fixture/standalone", revision: state.builtRevision, working: true}),
    })
    expect(rejected.ok).toBeFalse()
    expect(running.sessions.session("@fixture/standalone").snapshot().activeRevision).toBeNull()
  }, 120_000)

  test("protects control routes and never exposes the master capability to browser responses", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.standalone],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)

    const unauthorized = await fetch(new URL("/api/control/status", running.origin))
    expect(unauthorized.status).toBe(401)
    const wrongOrigin = await fetch(new URL("/api/control/status", running.origin), {
      headers: {
        authorization: `Bearer ${running.record.controlToken}`,
        origin: "https://evil.test",
      },
    })
    expect(wrongOrigin.status).toBe(403)
    expect((await fetch(new URL("/api/stop", running.origin), {method: "POST"})).status).toBe(404)

    const landing = await fetch(new URL("/", running.origin))
    const html = await landing.text()
    const publicStatus = await (await fetch(new URL("/api/status", running.origin))).text()
    const client = await (await fetch(new URL("/api/client", running.origin))).text()
    for (const value of [html, publicStatus, client]) {
      expect(value).not.toContain(running.record.controlToken)
      expect(value).not.toContain(fixture.standalone)
    }
    expect(browserSessionToken(html)).not.toBe(running.record.controlToken)
    expect(landing.headers.get("content-security-policy")).toContain("frame-ancestors 'none'")
    expect(landing.headers.get("content-security-policy"))
      .toContain(`connect-src 'self' data: blob: ws://${new URL(running.origin).host}`)
    expect(landing.headers.get("content-security-policy")).toContain("img-src 'self' data: blob:")

    const refusedStop = await controlPost(running, "/api/control/stop", {confirm: false})
    expect(refusedStop.response.status).toBe(400)
    expect((await fetch(new URL("/api/health", running.origin))).status).toBe(200)
  })

  test("выдаёт сохранённый снимок журнала только авторизованной browser-сессии", async () => {
    const fixture = serverFixture()
    const lifecycle = fakeBrowserLifecycle()
    const png = new Uint8Array([137, 80, 78, 71])
    const running = await startExternalStorybookServer({
      declarations: [fixture.standalone],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      browserLifecycle: {
        ...lifecycle.service,
        readCapture(captureId) {
          expect(captureId).toBe("capture_fixture")
          return {
            metadata: {
              captureId,
              resourceUri: `storybook://captures/${captureId}`,
              mimeType: "image/png",
              width: 1,
              height: 1,
              bytes: png.byteLength,
              sha256: "a".repeat(64),
              packageId: "@fixture/standalone",
              route: "",
              graphDigest: "b".repeat(64),
              revision: "fixture-revision",
              area: "page",
              consoleErrors: [],
              capturedAt: "2026-09-12T00:00:00.000Z",
            },
            png,
          }
        },
      },
    })
    servers.push(running)

    const unauthorized = await fetch(new URL("/api/browser/mcp-captures/capture_fixture", running.origin))
    expect(unauthorized.ok).toBeFalse()

    const session = await fetch(new URL("/api/browser/registry-session", running.origin), {
      method: "POST",
      headers: {origin: running.origin, "content-type": "application/json"},
      body: "{}",
    })
    const {readerToken} = await session.json() as {readerToken: string}
    const response = await fetch(new URL("/api/browser/mcp-captures/capture_fixture", running.origin), {
      headers: {origin: running.origin, "x-storybook-session": readerToken},
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png)
  })

  test("authorizes one ephemeral WebSocket session only for its exact scope", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.standalone],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const page = await fetch(new URL("/pkg-fixture-standalone/", running.origin))
    const token = browserSessionToken(await page.text())
    const url = new URL(`/api/events?session=${encodeURIComponent(token)}`, running.origin)
    url.protocol = "ws:"
    const socket = storybookSocket(url.href, running.origin)
    const messages: Array<Record<string, unknown>> = []
    await new Promise<void>((resolvePromise, reject) => {
      socket.addEventListener("open", () => resolvePromise(), {once: true})
      socket.addEventListener("error", () => reject(new Error("Scoped Storybook socket failed")), {once: true})
    })
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") messages.push(JSON.parse(event.data))
    })
    socket.send(JSON.stringify({type: "subscribe", topic: "registry"}))
    await waitFor(() => messages.some(({type}) => type === "subscription.failed"))
    expect(messages.at(-1)?.message).toContain("not authorized")
    socket.send(JSON.stringify({type: "subscribe", topic: "package:@fixture/standalone"}))
    await waitFor(() => messages.some(({type}) => type === "subscribed"))
    socket.close()
  }, 120_000)

  test("serves only declared README files, resources and literal local README assets", async () => {
    const fixture = serverFixture()
    const project = join(fixture.workspace, "projects", "alpha")
    const readme = join(project, "README.md")
    const linked = join(project, "linked.txt")
    const hidden = join(project, "hidden.txt")
    writeFileSync(linked, "linked asset\n")
    writeFileSync(hidden, "hidden owner file\n")
    writeFileSync(readme, "# Fixture Alpha\n\n[linked](./linked.txt)\n")
    const running = await startExternalStorybookServer({
      declarations: [fixture.workspace],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const client = await fetchJson(new URL("/api/client", running.origin))
    const node = client.nodes.find((candidate: {id: string}) => candidate.id === "package:fixture-alpha")
    expect((await fetch(new URL(`${node.resourceUrl}linked.txt`, running.origin))).status).toBe(200)
    expect((await fetch(new URL(`${node.resourceUrl}hidden.txt`, running.origin))).status).toBe(404)
    expect((await fetch(new URL(`${node.resourceUrl}.storybook/manifest.json`, running.origin))).status).toBe(404)
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
      "/pkg-fixture-components/components/button/basic/contained",
      running.origin,
    ))
    expect(components.status, await components.clone().text()).toBe(200)
    const componentState = running.sessions.session("@fixture/components").snapshot()
    expect(componentState.buildState, JSON.stringify(componentState.diagnostics)).toBe("built")
    expect(running.sessions.session("@fixture/docs").snapshot().builds).toBe(0)
  }, 120_000)

  test("serves ordered revision-scoped native author stylesheet links before the package entry", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.workspace],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      packageBrowserEntryPath: fixture.packageEntry,
    })
    servers.push(running)
    const candidate = (await running.sessions.ensure("@fixture/components")).builtRevision!
    const page = await fetch(new URL(
      `/pkg-fixture-components/components/button/basic/contained?preview=${candidate}`,
      running.origin,
    ))
    expect(page.status, await page.clone().text()).toBe(200)
    const html = await page.text()
    const session = running.sessions.session("@fixture/components")
    const state = session.snapshot()
    const revision = state.builtRevision ?? state.activatingRevision
    if (revision === null || revision === undefined) throw new Error("Fixture revision is missing")
    const graph = session.revisionGraphSnapshot(revision)
    if (graph === null) throw new Error("Fixture revision graph is missing")
    expect(graph.authorStyleSheets.map(({specifier, url}) => ({specifier, url}))).toEqual([
      {specifier: "@fixture/components/tokens.css", url: "author-style-sheets/0.css"},
      {specifier: "@fixture/components/theme.css", url: "author-style-sheets/1.css"},
    ])
    const revisionUrl = `/__storybook/revisions/%40fixture%2Fcomponents/${revision}/`
    const links = graph.authorStyleSheets.map((styleSheet, index) =>
      `<link id="external-storybook-author-style-sheet-${index}" rel="stylesheet" ` +
      `data-external-storybook-author-style-sheet="${styleSheet.specifier}" ` +
      `data-external-storybook-author-style-sheet-digest="${styleSheet.contentDigest}" ` +
      `href="${revisionUrl}${styleSheet.url}">`)
    expect(html).toContain(links[0]!)
    expect(html).toContain(links[1]!)
    expect(html.match(/id="external-storybook-author-style-sheet-[0-9]+"/gu)).toHaveLength(2)
    expect(html.indexOf(links[0]!)).toBeLessThan(html.indexOf(links[1]!))
    expect(html.indexOf(links[1]!)).toBeLessThan(html.indexOf("<script type=\"module\""))
    for (const [index, styleSheet] of graph.authorStyleSheets.entries()) {
      const response = await fetch(new URL(`${revisionUrl}${styleSheet.url}`, running.origin))
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("text/css; charset=utf-8")
      expect(await response.text()).toBe(await Bun.file(join(
        fixture.workspace,
        `projects/alpha/packages/components/${index === 0 ? "tokens.css" : "theme.css"}`,
      )).text())
    }
    expect(html).not.toContain(join(fixture.workspace, "projects/alpha/packages/components"))
  }, 120_000)

  test("refreshes author CSS content digest before publishing its next immutable revision", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      declarations: [fixture.workspace],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      packageBrowserEntryPath: fixture.packageEntry,
    })
    servers.push(running)
    await fetch(new URL(
      "/pkg-fixture-components/components/button/basic/contained",
      running.origin,
    ))
    const session = running.sessions.session("@fixture/components")
    const before = session.snapshot()
    const beforeRevision = before.builtRevision ?? before.activatingRevision
    if (beforeRevision === null || beforeRevision === undefined) throw new Error("Fixture revision is missing")
    const beforeGraph = session.revisionGraphSnapshot(beforeRevision)
    if (beforeGraph === null) throw new Error("Fixture revision graph is missing")
    const beforeDigest = beforeGraph.authorStyleSheets[0]?.contentDigest
    const registryRevision = running.registry.snapshot().revision
    const tokens = join(fixture.workspace, "projects/alpha/packages/components/tokens.css")
    writeFileSync(tokens, ":root { --fixture-accent: #ffffff; }\n")
    expect(running.watch.notify(tokens)).toBeGreaterThan(1)
    await waitFor(() => running.registry.snapshot().revision > registryRevision)
    const built = await running.sessions.ensure("@fixture/components")
    const nextRevision = built.builtRevision ?? built.activatingRevision
    if (nextRevision === null || nextRevision === undefined) throw new Error("Next fixture revision is missing")
    const nextGraph = session.revisionGraphSnapshot(nextRevision)
    if (nextGraph === null) throw new Error("Next fixture revision graph is missing")
    expect(nextRevision).not.toBe(beforeRevision)
    expect(nextGraph.authorStyleSheets[0]?.contentDigest).not.toBe(beforeDigest)
    expect(nextGraph.packageGraphDigest).not.toBe(beforeGraph.packageGraphDigest)
    const previousResponse = await fetch(new URL(
      `/__storybook/revisions/%40fixture%2Fcomponents/${beforeRevision}/author-style-sheets/0.css`,
      running.origin,
    ))
    expect(await previousResponse.text()).toBe(":root { --fixture-accent: #35c7d8; }\n")
    const response = await fetch(new URL(
      `/__storybook/revisions/%40fixture%2Fcomponents/${nextRevision}/author-style-sheets/0.css`,
      running.origin,
    ))
    expect(await response.text()).toBe(":root { --fixture-accent: #ffffff; }\n")
  }, 120_000)

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
    const before = await controlGet(running, "/api/control/status")
    const failed = await controlPost(running, "/api/control/attach", {
      roots: [fixture.standalone, join(fixture.root, "missing")],
    })
    expect(failed.response.status).toBe(404)
    const after = await controlGet(running, "/api/control/status")
    expect(after.graphDigest).toBe(before.graphDigest)
    expect(after.entries).toEqual(before.entries)
    expect(after.packages).toEqual(before.packages)
    expect(after.entries.some(({canonicalId}: {canonicalId: string}) =>
      canonicalId === "package:@fixture/standalone")).toBeFalse()
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
    const failed = await controlPost(running, "/api/control/attach", {roots: [fixture.workspace]})
    expect(failed.response.status).toBe(400)
    expect(running.registry.snapshot().revision).toBe(before.revision)
    expect(running.registry.snapshot().graph).toBe(before.graph)
    expect(running.sessions.snapshots()).toEqual([])
    expect((await controlGet(running, "/api/control/status")).entries).toEqual([])
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
    const project = client.nodes.find((node: {id: string}) => node.id === "package:fixture-alpha")
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
      "/pkg-fixture-components/components/button/basic/contained",
      running.origin,
    ))
    expect(page.status).toBe(200)
    expect(await page.text()).toContain("/__storybook/shared/entries/browser-entry-")
    const failed = running.sessions.session("@fixture/components").snapshot()
    expect(failed.buildState).toBe("failed")
    expect(failed.activeRevision).toBeNull()
    expect(failed.lastGoodRevision).toBeNull()
    expect(running.sessions.session("@fixture/docs").snapshot().builds).toBe(0)
    expect((await fetch(new URL("/api/health", running.origin))).status).toBe(200)
  })

  test("reserves browser tab creation for the agent control surface", async () => {
    const fixture = serverFixture()
    const lifecycle = fakeBrowserLifecycle()
    const running = await startExternalStorybookServer({
      declarations: [fixture.standalone],
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      browserLifecycle: lifecycle.service,
    })
    servers.push(running)
    const landing = await fetch(new URL("/", running.origin))
    const session = browserSessionToken(await landing.text())
    const eventsUrl = new URL(`/api/events?session=${encodeURIComponent(session)}`, running.origin)
    eventsUrl.protocol = "ws:"
    const socket = storybookSocket(eventsUrl.href, running.origin)
    await new Promise<void>((resolvePromise) => socket.addEventListener("open", () => resolvePromise(), {once: true}))
    const disconnected = new Promise<void>((resolvePromise) =>
      socket.addEventListener("close", () => resolvePromise(), {once: true}))
    socket.close()
    await disconnected
    const [control, browser] = await Promise.all([
      controlPost(running, "/api/control/open", {
        packageId: "@fixture/standalone",
        route: "",
      }),
      fetch(new URL("/api/browser/open", running.origin), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: running.origin,
          "x-storybook-session": session,
        },
        body: JSON.stringify({packageId: "@fixture/standalone", route: ""}),
      }),
    ])
    expect(control.body).toMatchObject({
      ok: true,
      packageId: "@fixture/standalone",
      viewId: lifecycle.viewId,
    })
    expect(browser.ok).toBeFalse()
    expect(lifecycle.opened).toHaveLength(1)
    expect(new Set(lifecycle.opened.map(({packageId}) => packageId)))
      .toEqual(new Set(["@fixture/standalone"]))
    expect(await controlGet(running, `/api/control/views/${encodeURIComponent(lifecycle.viewId)}`))
      .toMatchObject({
        ok: true,
        view: {viewId: lifecycle.viewId, packageId: "@fixture/standalone"},
      })
    const packagePage = await fetch(new URL("/pkg-fixture-standalone/", running.origin))
    const packageToken = browserSessionToken(await packagePage.text())
    const headers = {"content-type": "application/json", origin: running.origin, "x-storybook-session": packageToken}
    const openedFromPackage = await fetch(new URL("/api/browser/open", running.origin), {
      method: "POST", headers, body: JSON.stringify({packageId: "@fixture/standalone", route: ""}),
    })
    expect(openedFromPackage.ok).toBeFalse()
    const graphBeforeMutation = running.registry.snapshot().graph.digest
    const denied = await fetch(new URL("/api/browser/detach", running.origin), {
      method: "POST", headers, body: JSON.stringify({scopeId: "package:@fixture/standalone"}),
    })
    expect(denied.ok).toBeFalse()
    expect(running.registry.snapshot().graph.digest).toBe(graphBeforeMutation)
  })

  test("bounds authenticated control bodies before parsing", async () => {
    const fixture = serverFixture()
    const running = await startExternalStorybookServer({
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const response = await fetch(new URL("/api/control/attach", running.origin), {
      method: "POST",
      headers: {
        authorization: `Bearer ${running.record.controlToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({roots: ["x".repeat(70_000)]}),
    })
    expect(response.status).toBe(413)
    expect((await fetch(new URL("/api/health", running.origin))).status).toBe(200)
  })

  test("rolls back the listener and runtime when initial state publication fails", async () => {
    const fixture = serverFixture()
    const reservation = Bun.serve({port: 0, fetch: () => new Response("reserved")})
    const port = reservation.port
    reservation.stop(true)
    if (port === undefined) throw new Error("Bun test server did not allocate a port")
    await expect(startExternalStorybookServer({
      port,
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      writeServerRecord() {
        throw new Error("initial state write failed")
      },
    })).rejects.toThrow("initial state write failed")
    const replacement = Bun.serve({port, fetch: () => new Response("replacement")})
    expect(replacement.port).toBe(port)
    replacement.stop(true)
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
      browserLifecycle: fakeBrowserLifecycle().service,
    })
    servers.push(running)
    const detached = await controlPost(running, "/api/control/detach", {scopeId: "fixture-workspace"})
    expect(detached.response.status).toBe(200)
    expect((await fetchJson(new URL("/api/health", running.origin))).ok).toBeTrue()
    expect(running.sessions.snapshots().map(({packageId}) => packageId)).toEqual([
      "@fixture/standalone",
    ])
    expect(existsSync(fixture.statePath)).toBeTrue()
    const stopped = await controlPost(running, "/api/control/stop", {confirm: true})
    expect(stopped.response.status).toBe(200)
    await running.stopped
    expect(existsSync(fixture.statePath)).toBeFalse()
    servers.splice(servers.indexOf(running), 1)
  })
})

function fakeBrowserLifecycle(): Readonly<{
  service: StorybookBrowserLifecycle
  viewId: string
  opened: Array<Readonly<{packageId: string; route: string}>>
}> {
  const viewId = `storybook-view-v1_${"a".repeat(43)}`
  const opened: Array<Readonly<{packageId: string; route: string}>> = []
  const service: StorybookBrowserLifecycle = {
    async openPackage(input) {
      opened.push(Object.freeze({
        packageId: input.packageId,
        route: input.route,
      }))
      return Object.freeze({
        view: Object.freeze({
          viewId,
          packageId: input.packageId,
          route: input.route,
          title: "Fixture",
        }),
        identity: Object.freeze({
          protocol: "external-storybook-agent-bridge/1",
          packageId: input.packageId,
          route: input.route,
          revision: input.expectedRevision ?? "fixture-revision",
          graphDigest: "a".repeat(64),
          ready: true,
          presented: true,
          timeOrigin: 1,
        }),
        reused: opened.length > 1,
      })
    },
    async listViews() {
      const current = opened.at(-1)
      return current === undefined ? Object.freeze([]) : Object.freeze([Object.freeze({
        viewId,
        packageId: current.packageId,
        route: current.route,
        title: "Fixture",
      })])
    },
    getView(requestedViewId) {
      const current = opened.at(-1)
      if (requestedViewId !== viewId || current === undefined) throw new Error("Unknown fake view")
      return Object.freeze({
        viewId,
        packageId: current.packageId,
        route: current.route,
        title: "Fixture",
      })
    },
    async inspect() {
      return Object.freeze({ready: true, presented: true, revision: "fixture-revision"})
    },
    async interact() {
      return Object.freeze({ok: true})
    },
    async capture() {
      throw new Error("Fake browser lifecycle capture is not configured")
    },
    async close(requestedViewId) {
      return Object.freeze({closed: true, viewId: requestedViewId})
    },
    readCapture() {
      throw new Error("Fake browser lifecycle capture is not configured")
    },
  }
  return Object.freeze({service, viewId, opened})
}

function sharedEntriesFixture() {
  const root = mkdtempSync(join(import.meta.dir, "fixtures/.shared-browser-"))
  roots.push(root)
  const landing = join(root, "landing-entry.ts")
  const fallback = join(root, "fallback-entry.ts")
  writeFileSync(landing, 'document.title = "landing"\n')
  writeFileSync(fallback, 'document.title = "fallback"\n')
  return {root, landing, fallback}
}

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
  const source = join(import.meta.dir, "../discovery/fixtures/valid")
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

async function controlPost(server: ExternalStorybookRunningServer, path: string, body: unknown) {
  const response = await fetch(new URL(path, server.origin), {
    method: "POST",
    headers: {
      "authorization": `Bearer ${server.record.controlToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
  return {response, body: await response.json()}
}

async function controlGet(server: ExternalStorybookRunningServer, path: string): Promise<any> {
  const response = await fetch(new URL(path, server.origin), {
    headers: {authorization: `Bearer ${server.record.controlToken}`},
  })
  expect(response.status).toBe(200)
  return response.json()
}

function browserSessionToken(html: string): string {
  const token = html.match(/<meta name="external-storybook-browser-session" content="([A-Za-z0-9_-]+)">/u)?.[1]
  if (token === undefined) throw new Error("Storybook browser session token is missing")
  return token
}

function storybookSocket(url: string, origin: string): WebSocket {
  const Constructor = WebSocket as unknown as new (
    url: string,
    options: Readonly<{headers: Readonly<Record<string, string>>}>,
  ) => WebSocket
  return new Constructor(url, {headers: {origin}})
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(20)
  }
  throw new Error("Timed out waiting for Storybook server event")
}
