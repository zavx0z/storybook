import createWeb from "@app/web"
import {type Zavx0zStorybookBrowserLifecycle as Zavx0zStorybookBrowserLifecycleContract} from "@zavx0z/storybook-browser-lifecycle"
type StorybookBrowserLifecycle = Zavx0zStorybookBrowserLifecycleContract.Output
import TechLimitsOwner from "@tech/limits"
const STORYBOOK_SHARED_COMPILE_TIMEOUT_MS = TechLimitsOwner.STORYBOOK_SHARED_COMPILE_TIMEOUT_MS
const STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS = TechLimitsOwner.STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS
import {afterEach, describe, expect, setDefaultTimeout, spyOn, test} from "bun:test"
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {fileURLToPath} from "node:url"
import startExternalStorybookServer, {type AppServer} from "../index.ts"
import {StorybookBrowserSessionRegistry} from "../src/browser-session-registry.ts"
import {seedPublishedSharedAssets} from "./shared-assets.fixture.ts"
import {createProjectFixture} from "./project.fixture.ts"
import state from "@app-server/state"

const roots: string[] = []
const servers: AppServer.Output[] = []
const {writeExternalStorybookServerRecord} = state
setDefaultTimeout(STORYBOOK_SHARED_COMPILE_TIMEOUT_MS + STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS)

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()))
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("one external Storybook server", () => {

  test("isolated package check собирает ревизию без shared jobs и артефактов", async () => {
    const fixture = serverFixture()
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.standalone]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      packageBrowserEntryPath: fixture.packageEntry,
    })
    servers.push(running)
    expect(existsSync(join(fixture.artifactRoot, "shared"))).toBeFalse()
    const checked = await controlPost(running, "/api/control/check", {scope: "@fixture/standalone", live: false})
    expect(checked.body, JSON.stringify(checked.body)).toMatchObject({ok: true, applied: false})
    expect(running.sessions.session("@fixture/standalone").snapshot().builtRevision).toBeString()
    expect(running.sessions.buildSchedulerSnapshot().recent.filter(item => item.owner === "shared")).toEqual([])
    expect(existsSync(join(fixture.artifactRoot, "shared"))).toBeFalse()
  })

  test("навигация готовит отсутствующую сборку один раз и сохраняет рабочую при редактировании", async () => {
    const fixture = serverFixture()
    const packageId = "@fixture/standalone"
    const view = {viewId: `storybook-view-v1_${"n".repeat(43)}`, packageId, route: "", title: "Navigation"}
    let displayedRevision: string | null = null
    let presented = false
    let running: AppServer.Output
    const browserLifecycle: StorybookBrowserLifecycle = {
      ...fakeBrowserLifecycle().service,
      async listViews() { return [view] },
      async inspect() {
        return {packageId, route: "", revision: displayedRevision, ready: true, presented,
          frameSequence: presented ? 1 : 0, consoleErrors: [],
          graphDigest: displayedRevision === null ? null : running.sessions.session(packageId).revisionGraphSnapshot(displayedRevision)?.packageGraphDigest}
      },
    }
    const options = {project: createProjectFixture(fixture.root, [fixture.standalone]), statePath: fixture.statePath, artifactRoot: fixture.artifactRoot,
      browserLifecycle}
    seedPublishedSharedAssets(fixture.artifactRoot)
    running = await startTestServer(options)
    servers.push(running)
    const prepare = (previewRevision?: string) => fetch(new URL("/api/browser/prepare", running.origin), {
      method: "POST", headers: {origin: running.origin, "content-type": "application/json"},
      body: JSON.stringify({packageId, route: "", ...(previewRevision === undefined ? {} : {previewRevision})}),
    })
    expect((await prepare("absent-preview")).ok).toBeFalse()
    expect(running.sessions.session(packageId).snapshot().builds).toBe(0)
    const replies = await Promise.all([prepare(), prepare()])
    const targets = await Promise.all(replies.map(response => response.json()))
    expect(replies.map(reply => reply.status), JSON.stringify(targets)).toEqual([200, 200])
    expect(targets[0]).toMatchObject({kind: "revision", intent: "navigation-candidate", preview: false})
    expect(targets[1].revision).toBe(targets[0].revision)
    const session = running.sessions.session(packageId)
    expect(session.snapshot().builds).toBe(1)
    expect(session.snapshot().activeRevision).toBeNull()
    const html = await (await fetch(new URL("/standalone", running.origin))).text()
    expect(html).toContain(targets[0].revision)
    expect(session.snapshot().builds).toBe(1)
    const confirm = (token: string, body: unknown = {route: ""}) => fetch(new URL("/api/browser/confirm-navigation", running.origin), {
      method: "POST", headers: {origin: running.origin, "content-type": "application/json", "x-storybook-session": token},
      body: JSON.stringify(body),
    })
    const preview = await (await prepare(targets[0].revision)).json()
    expect((await confirm(preview.readerToken)).status).toBe(403)
    expect((await confirm(targets[0].readerToken, {route: "", revision: "arbitrary"})).ok).toBeFalse()
    displayedRevision = targets[0].revision
    expect((await confirm(targets[0].readerToken)).ok).toBeFalse()
    expect(session.snapshot().activeRevision).toBeNull()
    presented = true
    const confirmation = await confirm(targets[0].readerToken)
    expect(await confirmation.json()).toEqual({applied: true})
    expect(session.snapshot().activeRevision).toBe(targets[0].revision)
    const source = join(fixture.standalone, "index.ts")
    const original = readFileSync(source, "utf8")
    writeFileSync(source, `${original}\n/** Незавершённое редактирование. */\n`)
    const retained = await (await prepare()).json()
    expect(retained.revision).toBe(targets[0].revision)
    expect(session.snapshot().builds).toBe(1)
    writeFileSync(source, original)
    const receiptPath = join(session.revisionDirectory(targets[0].revision)!, "..", "applied.json")
    await running.stop()
    servers.splice(servers.indexOf(running), 1)
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"))
    delete receipt.sharedModuleEpoch
    delete receipt.inputFingerprint
    receipt.version = 1
    writeFileSync(receiptPath, JSON.stringify(receipt))
    running = await startTestServer(options)
    servers.push(running)
    const migrated = await (await prepare()).json()
    expect(migrated, JSON.stringify(migrated)).toMatchObject({kind: "revision", intent: "navigation-candidate"})
    expect(migrated.revision).not.toBe(targets[0].revision)
    expect(running.sessions.session(packageId).snapshot()).toMatchObject({builds: 1, activeRevision: targets[0].revision})
  }, 300_000)

  test("MCP Root работает без подключённых проектов", async () => {
    const fixture = serverFixture()
    const running = await startTestServer({project: createProjectFixture(fixture.root, []), statePath: fixture.statePath, artifactRoot: fixture.artifactRoot})
    servers.push(running)
    const response = await fetch(new URL("/api/control/storybook", running.origin), {
      method: "POST",
      headers: {authorization: `Bearer ${running.record.controlToken}`, "content-type": "application/json"},
      body: "{}",
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({label: "Fixture Project", description: expect.stringContaining("path"), children: []})
    expect(running.sessions.snapshots()).toEqual([])
  })

  test("адресный режим возвращает тот же ответ, что MCP, и не пишет в журнал агента", async () => {
    const {Client, InMemoryTransport} = await import("@modelcontextprotocol/client")
    const {McpServer} = await import("@modelcontextprotocol/server")
    const {default: appMcp} = await import("@app/mcp")
    const fixture = serverFixture()
    mkdirSync(join(fixture.standalone, "text/trim/contract"), {recursive: true})
    mkdirSync(join(fixture.standalone, "text/trim/spec"), {recursive: true})
    writeFileSync(join(fixture.standalone, "text/trim/index.ts"), '/** Удаляет пробелы.\n@packageDocumentation\n*/\nexport const trim = (text: string) => text.trim()')
    const inputSource = '/** Исходный текст. */\nexport type Input = string'
    const outputSource = '/** Текст без отступов. */\nexport type Output = string'
    const scenarioSource = 'throw new Error("Чтение не должно исполнять сценарий")'
    writeFileSync(join(fixture.standalone, "text/trim/contract/input.ts"), inputSource)
    writeFileSync(join(fixture.standalone, "text/trim/contract/output.ts"), outputSource)
    writeFileSync(join(fixture.standalone, "text/trim/spec/scenario.spec.ts"), scenarioSource)
    const running = await startTestServer({project: createProjectFixture(fixture.root, [fixture.standalone]), statePath: fixture.statePath, artifactRoot: fixture.artifactRoot})
    servers.push(running)
    const control = state.client(running.record)
    const mcp = new McpServer({name: "address-parity", version: "1"})
    appMcp.register(mcp, {request: (input, signal) => control.control("/api/control/storybook", input, signal)})
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({name: "address-parity", version: "1"})
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
    const session = await fetch(new URL("/api/browser/registry-session", running.origin), {method: "POST", headers: {origin: running.origin, "content-type": "application/json"}, body: "{}"})
    const {readerToken} = await session.json()
    const endpoint = new URL("/api/browser/mcp-address", running.origin)
    const read = (input: unknown, token = readerToken, origin = running.origin) => fetch(endpoint, {
      method: "POST",
      headers: {origin, "content-type": "application/json", "x-storybook-session": token},
      body: JSON.stringify(input),
    })
    try {
      for (const address of ["/", "/standalone", "/standalone?view=overview", "/standalone/text", "/standalone/text/trim?view=scenarios&inspector=x", "/standalone?preview=candidate"]) {
        const browser = await read({address})
        expect(browser.status).toBe(200)
        const input = address === "/" ? {} : {path: address.split("?")[0]!.slice(1)}
        const expected = await client.callTool({name: "storybook", arguments: input})
        expect(await browser.json()).toEqual({input, ...expected})
      }
      const content = await client.callTool({name: "storybook", arguments: {path: "standalone/text/trim"}})
      expect(content.structuredContent).toMatchObject({
        description: "Удаляет пробелы.", input: {type: "string", description: "Исходный текст."},
        output: {type: "string", description: "Текст без отступов."}, scenarios: [scenarioSource], children: [],
      })
      for (const path of ["standalone/internal", "standalone?view=scenarios"]) {
        expect((await client.callTool({name: "storybook", arguments: {path}})).isError).toBeTrue()
      }
      const missing = await (await read({address: "/missing?view=scenarios"})).json()
      expect(missing).toMatchObject({input: null, isError: true})
      expect(await (await read({address: "/standalone/internal?view=scenarios"})).json()).toMatchObject({input: null, isError: true})
      expect((await read({address: "/"}, "invalid")).status).toBe(401)
      expect((await read({address: "/"}, readerToken, "https://example.com")).ok).toBeFalse()
      expect((await read({address: "/", action: "journal"})).ok).toBeFalse()
      const journal = await fetch(new URL("/api/browser/mcp-requests", running.origin), {headers: {"x-storybook-session": readerToken}})
      expect(await journal.json()).toEqual({entries: []})
      expect(running.sessions.snapshots().every(item => item.builds === 0)).toBeTrue()
    } finally {
      await client.close()
      await mcp.close()
    }
  })

  test("выбор серверного сценария выполняет свежий тест с props", async () => {
    const fixture = serverFixture()
    const logPath = join(fixture.root, "scenario-runs.log")
    writeFileSync(join(fixture.standalone, "package.json"), JSON.stringify({
      name: "@fixture/standalone", label: "Standalone Fixture", version: "0.0.0", private: true, type: "module",
      exports: {".": "./index.ts"},
    }))
    writeFileSync(join(fixture.standalone, "index.ts"), [
      'import {appendFileSync} from "node:fs"',
      'import {randomUUID} from "node:crypto"',
      '/** Сохраняет свидетельство каждого фактического вызова. */',
      'export function evaluate(props: {value: string, logPath: string}) {',
      '  appendFileSync(props.logPath, props.value + "\\n")',
      '  return {value: props.value, stamp: randomUUID()}',
      '}',
    ].join("\n"))
    mkdirSync(join(fixture.standalone, "spec"))
    writeFileSync(join(fixture.standalone, "spec/scenario.spec.ts"), [
      'import {describe, expect, test} from "bun:test"',
      'import {evaluate} from "@fixture/standalone"',
      'describe.each([',
      `  {name: "Первый", props: {value: "a", logPath: ${JSON.stringify(logPath)}}},`,
      `  {name: "Второй", props: {value: "b", logPath: ${JSON.stringify(logPath)}}},`,
      '])("$name", ({props}) => {',
      '  const result = evaluate(props)',
      '  test("Значение", () => { expect(result.value, "Вход передан функции").toBe(props.value) })',
      '})',
    ].join("\n"))
    seedPublishedSharedAssets(fixture.artifactRoot)
    const running = await startTestServer({project: createProjectFixture(fixture.root, [fixture.standalone]),
      statePath: fixture.statePath, artifactRoot: fixture.artifactRoot,
      packageBrowserEntryPath: fixture.packageEntry})
    servers.push(running)
    const packageId = "@fixture/standalone"
    const session = running.sessions.session(packageId)
    const built = await running.sessions.ensure(packageId)
    const revision = built.builtRevision!
    expect(revision, JSON.stringify(built.diagnostics)).toBeString()
    const nodeId = `package:${packageId}`
    const prepared = await Bun.file(join(session.revisionDirectory(revision)!, "scenarios", `${encodeURIComponent(nodeId)}.json`)).json()
    const originalCalls = readFileSync(logPath, "utf8")
    const requestBody = {rerun: true, nodeId, revision, variantId: prepared.preview.variants[1].id, props: {value: "override", logPath}}
    const send = async (body = requestBody, stream = false) => {
      const grant = await fetch(new URL("/api/browser/session", running.origin), {method: "POST",
        headers: {origin: running.origin, "content-type": "application/json"}, body: JSON.stringify({packageId, revision})})
      const {token} = await grant.json()
      return fetch(new URL("/api/browser/scenarios/run", running.origin), {method: "POST",
        headers: {origin: running.origin, "content-type": "application/json", "x-storybook-session": token,
          accept: stream ? "application/x-ndjson" : "application/json"},
        body: JSON.stringify(body)})
    }
    const unauthorized = await fetch(new URL("/api/browser/scenarios/run", running.origin), {method: "POST",
      headers: {origin: running.origin, "content-type": "application/json"}, body: JSON.stringify(requestBody)})
    expect(unauthorized.status).toBe(401)
    const first = await send()
    expect(first.status, await first.clone().text()).toBe(200)
    const firstResult = await first.json()
    const second = await send()
    expect(second.status, await second.clone().text()).toBe(200)
    const secondResult = await second.json()
    expect(firstResult.execution).toEqual({status: "passed", tests: [{label: "Значение", status: "passed", message: null}]})
    expect(firstResult.calls[0].outcome.value.value).toBe("override")
    expect(secondResult.calls[0].outcome.value.stamp).not.toBe(firstResult.calls[0].outcome.value.stamp)
    expect(readFileSync(logPath, "utf8").slice(originalCalls.length)).toBe("override\noverride\n")
    expect((await send({...requestBody, nodeId: "package:another"})).ok).toBeFalse()
    expect(readFileSync(logPath, "utf8").slice(originalCalls.length)).toBe("override\noverride\n")
    const stream = await send(requestBody, true)
    expect(stream.headers.get("content-type")).toContain("application/x-ndjson")
    const events = (await stream.text()).trim().split("\n").map(line => JSON.parse(line))
    expect(events[0]).toEqual({type: "progress", progress: {phase: "queued"}})
    expect(events.some(event => event.progress?.text?.includes("Значение"))).toBeTrue()
    expect(events.at(-1)?.result.execution.status).toBe("passed")
  })

  test("журнал MCP принимает полный большой ответ через HTTP и завершает running", async () => {
    const fixture = serverFixture()
    const running = await startTestServer({project: createProjectFixture(fixture.root, [fixture.standalone]), statePath: fixture.statePath, artifactRoot: fixture.artifactRoot})
    servers.push(running)
    const entry = {id: "large-result", tool: "storybook", startedAt: Date.now(), input: JSON.stringify({node: "specs/scenarios"})}
    const begin = await controlPost(running, "/api/control/mcp-requests", {...entry, status: "running", durationMs: null, result: ""})
    expect(begin.response.status).toBe(200)
    const result = JSON.stringify({description: "данные".repeat(25000), tail: "конец ответа"}, null, 2)
    const complete = {...entry, status: "success", durationMs: 100, result}
    expect(new TextEncoder().encode(JSON.stringify(complete)).byteLength).toBeGreaterThan(65_536)
    const write = await controlPost(running, "/api/control/mcp-requests", complete)
    expect(write.response.status).toBe(200)
    const session = await fetch(new URL("/api/browser/registry-session", running.origin), {method: "POST", headers: {origin: running.origin, "content-type": "application/json"}, body: "{}"})
    expect(session.status).toBe(200)
    const {readerToken} = await session.json()
    const response = await fetch(new URL("/api/browser/mcp-requests", running.origin), {headers: {origin: running.origin, "x-storybook-session": readerToken}})
    expect(response.status).toBe(200)
    const {entries} = await response.json()
    expect(entries).toEqual([{...complete}])
    expect(JSON.parse(entries[0].result).tail).toBe("конец ответа")
    const oversized = await controlPost(running, "/api/control/mcp-requests", {...complete, result: "x".repeat(8 * 1024 * 1024)})
    expect(oversized.response.status).toBe(413)
    expect(running.sessions.snapshots().every(item => item.builds === 0)).toBeTrue()
  })

  test("корневой REST возвращает подключённые корни без сборки", async () => {
    const fixture = serverFixture()
    const metadata = JSON.parse(readFileSync(join(fixture.standalone, "package.json"), "utf8"))
    writeFileSync(join(fixture.standalone, "package.json"), JSON.stringify({...metadata, description: "Назначение подключённого проекта"}))
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.standalone]),
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
    const value = await response.json() as {label: string, description: string, children: {path: string, label: string, description: string}[]}
    expect(Object.keys(value).sort()).toEqual(["children", "description", "label"])
    expect(value.children.map(child => child.path)).toEqual(["standalone"])
    expect(value.label).toBe("Fixture Project")
    expect(value.description).toContain("path")
    expect(value.children[0]?.description).toBe("Назначение подключённого проекта")
    expect(value.children.every(node => typeof node.description === "string")).toBe(true)
    expect(running.sessions.snapshots().every(item => item.builds === 0)).toBe(true)
  })

  test("shared worker восстанавливает проверенные ресурсы после перезапуска без компиляции", async () => {
    const fixture = serverFixture()
    const entries = sharedEntriesFixture()
    const options = {
      project: createProjectFixture(fixture.root, [fixture.standalone]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      landingEntryPath: entries.landing,
      fallbackEntryPath: entries.fallback,
    }
    let running = await startTestServer(options)
    servers.push(running)
    await publishTestShared(running)
    const preparation = await controlPost(running, "/api/control/check", {scope: null})
    expect(preparation.body, JSON.stringify(preparation.body)).toMatchObject({ok: true})
    const first = await fetch(new URL("/", running.origin))
    const firstHtml = await first.text()
    expect(first.status).toBe(200)
    expect(firstHtml).toContain('<script type="module"')
    expect(firstHtml).toContain("/__storybook/shared/styles/")
    expect(running.sessions.buildSchedulerSnapshot().recent.find(item => item.owner === "shared")?.cache).toEqual({status: "miss", layer: "shared"})
    await running.stop()
    servers.splice(servers.indexOf(running), 1)
    running = await startTestServer(options)
    servers.push(running)
    const second = await fetch(new URL("/", running.origin))
    expect(second.status).toBe(200)
    expect(await second.text()).toContain('<script type="module"')
    expect(running.sessions.buildSchedulerSnapshot().recent).toEqual([])
    expect(running.sessions.snapshots().every(item => item.builds === 0)).toBe(true)
    await controlPost(running, "/api/control/check", {scope: "@fixture/standalone"})
    const fallback = await fetch(new URL("/pkg-fixture-standalone/?inspector=source", running.origin))
    expect(fallback.status).toBe(200)
    const packageHtml = await fallback.text()
    expect(packageHtml).toContain('<script type="module"')
    expect(packageHtml).toContain('"intent":"navigation-candidate"')
    expect(running.sessions.buildSchedulerSnapshot().recent.filter(item => item.owner === "shared").every(item => item.cache.status === "hit")).toBeTrue()
    expect(running.sessions.session("@fixture/standalone").snapshot().builds).toBe(1)
    expect(running.sessions.session("@fixture/standalone").snapshot().activeRevision).toBeNull()
    await running.stop()
    servers.splice(servers.indexOf(running), 1)
    const receipt = JSON.parse(readFileSync(join(fixture.artifactRoot, "shared/receipt.json"), "utf8"))
    // CSS-адрес содержит digest его байтов и повторяется при неизменной теме.
    const style = receipt.assets.authorStyleSheets?.[0] as {url: string} | undefined
    expect(style?.url).toBeString()
    const damaged = join(fixture.artifactRoot, "shared", style!.url)
    const originalArtifact = readFileSync(damaged)
    writeFileSync(damaged, "damaged output")
    running = await startTestServer(options)
    servers.push(running)
    const collision = await controlPost(running, "/api/control/check", {scope: "storybook:shared"})
    expect(collision.response.status, JSON.stringify(collision.body)).toBe(400)
    expect(collision.body.error, JSON.stringify(collision.body)).toContain("Immutable shared artifact collision")
    expect(readFileSync(damaged, "utf8")).toBe("damaged output")
    // Восстанавливаем повреждённую тестом копию перед новой явной подготовкой.
    writeFileSync(damaged, originalArtifact)
    writeFileSync(entries.landing, "document.documentElement.dataset.fixtureLanding = 'recovered'\n")
    await publishTestShared(running)
    const recovery = await controlPost(running, "/api/control/check", {scope: "@fixture/standalone"})
    expect(recovery.body, JSON.stringify(recovery.body)).toMatchObject({ok: true})
    expect(await (await fetch(new URL("/", running.origin))).text()).toContain('<script type="module"')
    expect(running.sessions.buildSchedulerSnapshot().recent.find(item => item.owner === "shared")?.cache.status).toBe("miss")
  }, 3 * STORYBOOK_SHARED_COMPILE_TIMEOUT_MS + 2 * STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS)

  test("status показывает preflight и нагрузку, не запрашивая сборку", async () => {
    const fixture = serverFixture()
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.standalone]),
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
    expect(value.dependencyWatch).toBeUndefined()
    expect(JSON.stringify(value.buildScheduler)).not.toContain('"pid"')
  })

  test("сообщает этапы запуска в порядке подготовки каталога и публикации сервера", async () => {
    const fixture = serverFixture()
    const phases: string[] = []
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.standalone]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      onStartupPhase: phase => phases.push(phase),
    })
    servers.push(running)
    expect(phases).toEqual(["catalog", "sessions", "listen", "publication", "ready"])
    expect(existsSync(fixture.statePath)).toBe(true)
  })

  test("состав Project перечитывается из .gitmodules при refresh и restart, включая пустой состав", async () => {
    const fixture = serverFixture()
    const entries = sharedEntriesFixture()
    seedPublishedSharedAssets(fixture.artifactRoot)
    const options = {
      project: createProjectFixture(fixture.root, [fixture.workspace]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      landingEntryPath: entries.landing,
      fallbackEntryPath: entries.fallback,
      browserLifecycle: fakeBrowserLifecycle().service,
    }
    const workspaceFile = join(fixture.workspace, "package.json")
    const workspaceBytes = readFileSync(workspaceFile, "utf8")
    let running = await startTestServer(options)
    servers.push(running)
    expect(running.registry.snapshot().entries).toHaveLength(1)
    createProjectFixture(fixture.root, [fixture.workspace, fixture.standalone])
    expect((await controlPost(running, "/api/control/refresh", {})).response.status).toBe(200)
    expect(running.registry.snapshot().entries).toHaveLength(2)
    expect(readFileSync(workspaceFile, "utf8")).toBe(workspaceBytes)
    createProjectFixture(fixture.root, [fixture.standalone])
    expect((await controlPost(running, "/api/control/refresh", {})).response.status).toBe(200)
    expect(running.registry.snapshot().graph.nodes.some(node => node.id === "package:fixture-alpha")).toBeFalse()
    expect(running.registry.snapshot().graph.nodes.some(node => node.id === "package:@fixture/standalone")).toBeTrue()
    await running.stop()
    servers.splice(servers.indexOf(running), 1)
    running = await startTestServer(options)
    servers.push(running)
    expect(running.registry.snapshot().entries).toHaveLength(1)
    expect(running.registry.snapshot().entries[0]?.canonicalId).toBe("package:@fixture/standalone")
    createProjectFixture(fixture.root, [])
    await running.stop()
    servers.splice(servers.indexOf(running), 1)
    running = await startTestServer(options)
    servers.push(running)
    expect(running.registry.snapshot().entries).toEqual([])
    const empty = await fetch(new URL("/", running.origin))
    expect(empty.status).toBe(200)
    const emptyHtml = await empty.text()
    const style = emptyHtml.match(/href="([^"]*\/shared\/styles\/[^"]+\.css)"/u)?.[1]
    expect(style).toBeDefined()
    const stylesheet = await fetch(new URL(style!, running.origin))
    expect(stylesheet.status).toBe(200)
    expect(await stylesheet.text()).toContain("--surface-")
    expect(readFileSync(workspaceFile, "utf8")).toBe(workspaceBytes)
    expect(existsSync(join(fixture.root, "state/projects.json"))).toBeFalse()
  })

  test("старый список projects.json игнорируется, TODO endpoints не меняют состав", async () => {
    const fixture = serverFixture()
    const saved = join(fixture.root, "state/projects.json")
    mkdirSync(join(fixture.root, "state"), {recursive: true})
    const oldBytes = JSON.stringify([fixture.standalone])
    writeFileSync(saved, oldBytes)
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.workspace]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const before = running.registry.snapshot()
    expect(before.entries.map(entry => entry.canonicalId)).toEqual(["package:fixture-workspace"])
    const modulesBytes = readFileSync(join(fixture.root, ".gitmodules"), "utf8")
    const sessionReply = await fetch(new URL("/api/browser/registry-session", running.origin), {
      method: "POST", headers: {origin: running.origin, "content-type": "application/json"}, body: "{}",
    })
    expect(sessionReply.status).toBe(200)
    const {readerToken} = await sessionReply.json()
    const browserChange = (action: string, origin = running.origin) => fetch(new URL(`/api/browser/${action}`, running.origin), {
      method: "POST",
      headers: {origin, "content-type": "application/json", "x-storybook-session": readerToken},
      body: JSON.stringify({selectionToken: "unimplemented", scopeId: "package:fixture-workspace"}),
    })
    expect((await browserChange("attach", "https://foreign.invalid")).status).toBe(403)
    for (const action of ["directory", "attach", "detach"]) {
      expect((await browserChange(action)).status).toBe(501)
    }
    for (const action of ["attach", "detach"]) {
      expect((await controlPost(running, `/api/control/${action}`, {roots: [fixture.standalone], scopeId: "package:fixture-workspace"})).response.status)
        .toBe(501)
    }
    expect(running.registry.snapshot()).toEqual(before)
    expect(readFileSync(saved, "utf8")).toBe(oldBytes)
    expect(readFileSync(join(fixture.root, ".gitmodules"), "utf8")).toBe(modulesBytes)
    const client = await fetchJson(new URL("/api/client", running.origin))
    expect(client.rootIds).toEqual(["package:fixture-workspace"])
  })

  test("собственное имя Project обновляется и публикуется при неизменном графе Repo", async () => {
    const fixture = serverFixture()
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.standalone], "Initial Project"),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const before = await fetchJson(new URL("/api/client", running.origin))
    expect(before.projectName).toBe("Initial Project")
    const response = await fetch(new URL("/api/browser/registry-session", running.origin), {
      method: "POST", headers: {origin: running.origin, "content-type": "application/json"}, body: "{}",
    })
    const {readerToken} = await response.json()
    const events = new URL(`/api/events?session=${encodeURIComponent(readerToken)}`, running.origin)
    events.protocol = "ws:"
    const socket = storybookSocket(events.href, running.origin)
    const messages: {type: string, snapshot?: {projectName?: string}}[] = []
    socket.addEventListener("message", event => messages.push(JSON.parse(String(event.data))))
    try {
      await new Promise<void>(resolvePromise => socket.addEventListener("open", () => resolvePromise(), {once: true}))
      socket.send(JSON.stringify({type: "subscribe", topic: "registry"}))
      await waitFor(() => messages.some(message => message.type === "subscribed"))
      const first = messages.length
      writeFileSync(join(fixture.root, "package.json"), JSON.stringify({name: "Renamed Project", label: "Ignored label"}))
      expect((await controlPost(running, "/api/control/refresh", {})).response.status).toBe(200)
      await waitFor(() => messages.slice(first).some(message => message.type === "registry.updated"))
      const after = await fetchJson(new URL("/api/client", running.origin))
      expect(after.projectName).toBe("Renamed Project")
      expect(after.graphDigest).toBe(before.graphDigest)
      expect(running.sessions.snapshots().map(session => session.builds)).toEqual([0])
    } finally {
      socket.close()
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

  test("serves explicitly prepared shared and package revisions on one origin", async () => {
    const fixture = serverFixture()
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.standalone]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    await publishTestShared(running)
    await controlPost(running, "/api/control/check", {scope: null})
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
    const revisionDocumentation = await fetch(new URL(
      `/__storybook/revisions/%40fixture%2Fstandalone/${state.builtRevision}/resources/nodes/${
        encodeURIComponent("package:@fixture/standalone")
      }/module.md`,
      running.origin,
    ))
    expect(revisionDocumentation.status).toBe(200)
    expect(await revisionDocumentation.text()).toContain("Standalone")
    expect(new URL(packagePage.url).origin).toBe(running.origin)
    const checked = await controlPost(running, "/api/control/check", {scope: "@fixture/standalone"})
    expect(checked.response.status).toBe(200)
    expect(running.sessions.session("@fixture/standalone").snapshot().builds).toBe(1)
  }, STORYBOOK_SHARED_COMPILE_TIMEOUT_MS + STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS)

  test("refreshes shared dependencies on the same server and keeps old hashed assets available", async () => {
    const fixture = serverFixture()
    const entries = sharedEntriesFixture()
    const dependency = join(entries.root, "code-view.ts")
    writeFileSync(dependency, 'export const height = "160px"\n')
    writeFileSync(entries.landing, 'import {height} from "./code-view.ts"\ndocument.title = height\n')
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, []),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      landingEntryPath: entries.landing,
      fallbackEntryPath: entries.fallback,
    })
    servers.push(running)
    await publishTestShared(running)
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
    expect(await entry()).toBe(first)
    await publishTestShared(running)
    const second = await entry()
    expect(second).not.toBe(first)
    expect(await (await fetch(new URL(second, running.origin))).text()).toContain("auto")
    expect(await (await fetch(new URL(first, running.origin))).text()).toBe(original)
    expect(running.record.instanceId).toBe(instance)
    expect((await fetch(new URL("/api/health", running.origin))).status).toBe(200)
  }, 2 * (STORYBOOK_SHARED_COMPILE_TIMEOUT_MS + STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS))

  test("явный refresh сообщает изменение TSDoc, сохраняя сборки и сервер", async () => {
    const fixture = serverFixture()
    const entries = sharedEntriesFixture()
    seedPublishedSharedAssets(fixture.artifactRoot)
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.workspace]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      landingEntryPath: entries.landing,
      fallbackEntryPath: entries.fallback,
      packageBrowserEntryPath: fixture.packageEntry,
      browserLifecycle: fakeBrowserLifecycle().service,
    })
    servers.push(running)
    await controlPost(running, "/api/control/check", {scope: null})
    const page = await fetch(new URL("/api/browser/prepare", running.origin), {
      method: "POST",
      headers: {origin: running.origin, "content-type": "application/json"},
      body: JSON.stringify({packageId: "fixture-alpha", route: ""}),
    })
    const prepared = await page.json() as {readerToken: string}
    expect(page.status, JSON.stringify({prepared, session: running.sessions.session("fixture-alpha").snapshot()})).toBe(200)
    const url = new URL(`/api/events?session=${encodeURIComponent(prepared.readerToken)}`, running.origin)
    url.protocol = "ws:"
    const socket = storybookSocket(url.href, running.origin)
    const messages: Array<Record<string, unknown>> = []
    socket.addEventListener("message", event => { messages.push(JSON.parse(String(event.data))) })
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), {once: true})
      socket.addEventListener("error", () => reject(new Error("documentation socket failed")), {once: true})
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
      const documentation = join(fixture.workspace, "projects/alpha/index.ts")
      const refreshEventStart = messages.length
      writeFileSync(documentation, "/**\n# Updated project documentation\n@packageDocumentation\n*/\n")
      await fetch(new URL("/api/control/refresh", running.origin), {method: "POST", headers: {authorization: `Bearer ${running.record.controlToken}`, "content-type": "application/json"}, body: JSON.stringify({force: true})})
      await waitFor(() => messages.slice(refreshEventStart).some(message => message.type === "registry.updated"))
      expect(running.registry.snapshot().revision).not.toBe(revision)
      expect(messages.slice(refreshEventStart).some(message => message.type === "shared.updated")).toBe(false)
      expect(running.sessions.snapshots().filter(snapshot => snapshot.packageId !== "fixture-alpha").map(snapshot => snapshot.builds)).toEqual(builds)
      expect(running.record.instanceId).toBe(instance)
    } finally {
      socket.close()
    }
  })

  test("один origin обслуживает Repo объявленные в .gitmodules", async () => {
    const fixture = serverFixture()
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, []),
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
    createProjectFixture(fixture.root, [fixture.workspace])
    expect((await controlPost(running, "/api/control/refresh", {})).response.status).toBe(200)
    createProjectFixture(fixture.root, [fixture.workspace, fixture.standalone])
    expect((await controlPost(running, "/api/control/refresh", {})).response.status).toBe(200)
    const client = await fetchJson(new URL("/api/client", running.origin))
    expect(client.rootIds).toEqual(["package:fixture-workspace", "package:@fixture/standalone"])
    expect(client.packages).toHaveLength(6)
    expect(new Set(client.nodes.map((node: {urlPath: string}) => new URL(node.urlPath, running.origin).origin)))
      .toEqual(new Set([running.origin]))
    const directory = client.nodes.find((node: {id: string}) => node.id === "directory:package:@fixture/components/docs")
    expect(directory).toMatchObject({kind: "directory", routePath: "dir-docs"})
    expect(running.record.attachedDeclarations).toHaveLength(2)
    expect(running.record.controlToken).toMatch(/^[A-Za-z0-9_-]{43}$/u)
  })

  test("изменение структуры не запускает refresh или сборку", async () => {
    const fixture = serverFixture()
    const running = await startTestServer({project: createProjectFixture(fixture.root, [fixture.workspace]), statePath: fixture.statePath, artifactRoot: fixture.artifactRoot})
    servers.push(running)
    const before = running.registry.snapshot().revision
    const empty = join(fixture.workspace, "empty")
    mkdirSync(empty)
    rmSync(empty, {recursive: true})
    writeFileSync(join(fixture.workspace, "index.ts"), "/** Изменение */\n")
    await Bun.sleep(1100)
    expect(running.registry.snapshot().revision).toBe(before)
    expect(running.sessions.snapshots().every(session => session.builds === 0)).toBeTrue()
  })

  test("explicit refresh reconciles an attached package structure after filesystem changes without subscriptions", async () => {
    const fixture = serverFixture()
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.workspace]),
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
    seedPublishedSharedAssets(fixture.artifactRoot)
    const running = await startTestServer({project: createProjectFixture(fixture.root, [fixture.standalone]), statePath: fixture.statePath, artifactRoot: fixture.artifactRoot})
    servers.push(running)
    await controlPost(running, "/api/control/check", {scope: null})
    const page = await fetch(new URL("/pkg-fixture-standalone/", running.origin))
    const html = await page.text()
    expect(page.status).toBe(200)
    expect(html).not.toContain('name="external-storybook-activation-id"')
    const state = running.sessions.session("@fixture/standalone").snapshot()
    expect(state.builtRevision).not.toBeNull()
    expect(html).toContain(`/__storybook/revisions/%40fixture%2Fstandalone/${state.builtRevision}/`)
    expect(html).toContain('name="external-storybook-bootstrap-intent" content="navigation-candidate"')
    expect(state.activeRevision).toBeNull()
    const rejected = await fetch(new URL("/api/browser/activation", running.origin), {
      method: "POST", headers: {origin: running.origin, "content-type": "application/json", "x-storybook-session": browserSessionToken(html)},
      body: JSON.stringify({packageId: "@fixture/standalone", revision: state.builtRevision, working: true}),
    })
    expect(rejected.ok).toBeFalse()
    expect(running.sessions.session("@fixture/standalone").snapshot().activeRevision).toBeNull()
  }, STORYBOOK_SHARED_COMPILE_TIMEOUT_MS + STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS)

  test("protects control routes and never exposes the master capability to browser responses", async () => {
    const fixture = serverFixture()
    seedPublishedSharedAssets(fixture.artifactRoot)
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.standalone]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    await controlPost(running, "/api/control/check", {scope: null})

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
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.standalone]),
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
    seedPublishedSharedAssets(fixture.artifactRoot)
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.standalone]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    await controlPost(running, "/api/control/check", {scope: null})
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
  }, STORYBOOK_SHARED_COMPILE_TIMEOUT_MS + STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS)

  test("serves only TSDoc source and literal local documentation assets", async () => {
    const fixture = serverFixture()
    const project = join(fixture.workspace, "projects", "alpha")
    const documentation = join(project, "index.ts")
    const linked = join(project, "linked.txt")
    const hidden = join(project, "hidden.txt")
    writeFileSync(linked, "linked asset\n")
    writeFileSync(hidden, "hidden owner file\n")
    writeFileSync(documentation, "/**\n# Fixture Alpha\n\n[linked](./linked.txt)\n@packageDocumentation\n*/\n")
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.workspace]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const client = await fetchJson(new URL("/api/client", running.origin))
    const node = client.nodes.find((candidate: {id: string}) => candidate.id === "package:fixture-alpha")
    expect(await (await fetch(new URL(node.resourceUrl, running.origin))).text()).toContain("Fixture Alpha")
    expect((await fetch(new URL(`${node.resourceUrl}linked.txt`, running.origin))).status).toBe(200)
    expect((await fetch(new URL(`${node.resourceUrl}hidden.txt`, running.origin))).status).toBe(404)
    expect((await fetch(new URL(`${node.resourceUrl}package.json`, running.origin))).status).toBe(404)
    expect((await fetch(new URL(`${node.resourceUrl}README.md`, running.origin))).status).toBe(404)
  })

  test("builds only the requested structural package revision", async () => {
    const fixture = serverFixture()
    seedPublishedSharedAssets(fixture.artifactRoot)
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.workspace]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    await controlPost(running, "/api/control/check", {scope: "@fixture/components"})
    const components = await fetch(new URL(
      "/pkg-fixture-components/",
      running.origin,
    ))
    expect(components.status, await components.clone().text()).toBe(200)
    const componentState = running.sessions.session("@fixture/components").snapshot()
    expect(componentState.buildState, JSON.stringify(componentState.diagnostics)).toBe("built")
    expect(running.sessions.session("@fixture/docs").snapshot().builds).toBe(0)
  }, STORYBOOK_SHARED_COMPILE_TIMEOUT_MS + STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS)

  test("serves the revision-scoped Workbench theme", async () => {
    const fixture = serverFixture()
    const running = await startTestServer({project: createProjectFixture(fixture.root, [fixture.workspace]), statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot, packageBrowserEntryPath: fixture.packageEntry})
    servers.push(running)
    const built = await running.sessions.ensure("@fixture/components")
    const revision = built.builtRevision!
    const graph = running.sessions.session("@fixture/components").revisionGraphSnapshot(revision)!
    expect(graph.workbenchAuthorStyleSheets.map(({specifier}) => specifier)).toEqual(["@zavx0z/ui/theme/theme.css"])
    const resource = graph.workbenchAuthorStyleSheets[0]!
    const response = await fetch(new URL(`/__storybook/revisions/%40fixture%2Fcomponents/${revision}/${resource.url}`, running.origin))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/css; charset=utf-8")
  }, STORYBOOK_SHARED_COMPILE_TIMEOUT_MS + STORYBOOK_PACKAGE_COMPILE_TIMEOUT_MS)

  test("неверный состав при refresh сохраняет предыдущие registry и sessions", async () => {
    const fixture = serverFixture()
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.workspace]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      landingEntryPath: fixture.landingEntry,
      fallbackEntryPath: fixture.fallbackEntry,
      packageBrowserEntryPath: fixture.packageEntry,
    })
    servers.push(running)
    const before = await controlGet(running, "/api/control/status")
    createProjectFixture(fixture.root, [fixture.workspace, fixture.standalone])
    writeFileSync(join(fixture.root, ".gitmodules"), `${readFileSync(join(fixture.root, ".gitmodules"), "utf8")}\n[submodule "missing"]\npath = missing\n`)
    const failed = await controlPost(running, "/api/control/refresh", {})
    expect(failed.response.status).toBe(400)
    const after = await controlGet(running, "/api/control/status")
    expect(after.graphDigest).toBe(before.graphDigest)
    expect(after.entries).toEqual(before.entries)
    expect(after.packages).toEqual(before.packages)
    expect(after.entries.some(({canonicalId}: {canonicalId: string}) => canonicalId === "package:@fixture/standalone")).toBeFalse()
  })

  test("rolls back graph, sessions and state when post-validation publication fails", async () => {
    const fixture = serverFixture()
    let writes = 0
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, []),
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
    createProjectFixture(fixture.root, [fixture.workspace])
    const failed = await controlPost(running, "/api/control/refresh", {})
    expect(failed.response.status).toBe(400)
    expect(running.registry.snapshot().revision).toBe(before.revision)
    expect(running.registry.snapshot().graph).toBe(before.graph)
    expect(running.sessions.snapshots()).toEqual([])
    expect((await controlGet(running, "/api/control/status")).entries).toEqual([])
  })

  test("fails closed when an attached TSDoc source is replaced by an escaping symlink", async () => {
    const fixture = serverFixture()
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.workspace]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const documentation = join(fixture.workspace, "projects/alpha/index.ts")
    const outside = join(fixture.root, "outside-secret.md")
    writeFileSync(outside, "outside secret\n")
    unlinkSync(documentation)
    symlinkSync(outside, documentation)
    const client = await fetchJson(new URL("/api/client", running.origin))
    const project = client.nodes.find((node: {id: string}) => node.id === "package:fixture-alpha")
    const response = await fetch(new URL(project.resourceUrl, running.origin))
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain("outside secret")
  })

  test("shows an isolated shell when a structural package has no last-good revision", async () => {
    const fixture = serverFixture()
    writeFileSync(fixture.packageEntry, "export const broken = {\n")
    seedPublishedSharedAssets(fixture.artifactRoot)
    const running = await startTestServer({project: createProjectFixture(fixture.root, [fixture.workspace]), statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot, packageBrowserEntryPath: fixture.packageEntry})
    servers.push(running)
    await controlPost(running, "/api/control/check", {scope: "@fixture/components"})
    const page = await fetch(new URL("/pkg-fixture-components/", running.origin))
    expect(page.status).toBe(200)
    expect(await page.text()).toContain("external-storybook-canvas")
    const failed = running.sessions.session("@fixture/components").snapshot()
    expect(failed.buildState).toBe("failed")
    expect(failed.activeRevision).toBeNull()
    expect(failed.lastGoodRevision).toBeNull()
    expect(running.sessions.session("@fixture/docs").snapshot().builds).toBe(0)
    expect((await fetch(new URL("/api/health", running.origin))).status).toBe(200)
  })

  test("открытие старой ревизии требует check до обращения к браузеру", async () => {
    const fixture = serverFixture()
    const lifecycle = fakeBrowserLifecycle()
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.standalone]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      browserLifecycle: lifecycle.service,
    })
    servers.push(running)
    const session = running.sessions.session("@fixture/standalone")
    const initial = session.snapshot()
    const legacy = {...initial, activeRevision: "legacy-working", lastWorkingRevision: "legacy-working"}
    const snapshot = spyOn(session, "snapshot").mockReturnValue(legacy)
    try {
      const result = await controlPost(running, "/api/control/open", {packageId: initial.packageId, route: ""})
      expect(result.response.ok).toBeFalse()
      expect(JSON.stringify(result.body)).toContain("старый формат")
      expect(JSON.stringify(result.body)).toContain("storybook_check")
      expect(lifecycle.opened).toEqual([])
      expect(session.snapshot().activeRevision).toBe("legacy-working")
      expect(session.snapshot().lastWorkingRevision).toBe("legacy-working")
      expect(session.snapshot().builds).toBe(0)
    } finally { snapshot.mockRestore() }
  })

  test("reserves browser tab creation for the agent control surface", async () => {
    const fixture = serverFixture()
    seedPublishedSharedAssets(fixture.artifactRoot)
    const lifecycle = fakeBrowserLifecycle()
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.standalone]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      browserLifecycle: {
        ...lifecycle.service,
        async listViews(...args) {
          if (lifecycle.opened.length === 0) throw new Error("Browser has not started")
          return lifecycle.service.listViews(...args)
        },
      },
    })
    servers.push(running)
    await controlPost(running, "/api/control/check", {scope: null})
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
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, []),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
    })
    servers.push(running)
    const response = await fetch(new URL("/api/control/refresh", running.origin), {
      method: "POST",
      headers: {
        authorization: `Bearer ${running.record.controlToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({force: "x".repeat(70_000)}),
    })
    expect(response.status).toBe(413)
    expect((await fetch(new URL("/api/health", running.origin))).status).toBe(200)
  })

  test("rolls back the listener and runtime when initial state publication fails", async () => {
    const fixture = serverFixture()
    let webDisposals = 0
    const reservation = Bun.serve({port: 0, fetch: () => new Response("reserved")})
    const port = reservation.port
    reservation.stop(true)
    if (port === undefined) throw new Error("Bun test server did not allocate a port")
    await expect(startExternalStorybookServer({

      browserLifecycle: fakeBrowserLifecycle().service,
      createWeb(input) {
        const web = createWeb(input)
        return {...web, async dispose() {
          webDisposals++
          await web.dispose()
        }}
      },
      project: createProjectFixture(fixture.root, []),
      port,
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      writeServerRecord() {
        throw new Error("initial state write failed")
      },
    })).rejects.toThrow("initial state write failed")
    expect(webDisposals, "Ошибка публикации завершает созданного владельца Web до отказа запуска").toBe(1)
    const replacement = Bun.serve({port, fetch: () => new Response("replacement")})
    expect(replacement.port).toBe(port)
    replacement.stop(true)
  })

  test("удаление участия через .gitmodules сохраняет сервер, stop удаляет только своё состояние", async () => {
    const fixture = serverFixture()
    const running = await startTestServer({
      project: createProjectFixture(fixture.root, [fixture.workspace, fixture.standalone]),
      statePath: fixture.statePath,
      artifactRoot: fixture.artifactRoot,
      landingEntryPath: fixture.landingEntry,
      fallbackEntryPath: fixture.fallbackEntry,
      packageBrowserEntryPath: fixture.packageEntry,
      browserLifecycle: fakeBrowserLifecycle().service,
    })
    servers.push(running)
    createProjectFixture(fixture.root, [fixture.standalone])
    const refreshed = await controlPost(running, "/api/control/refresh", {})
    expect(refreshed.response.status).toBe(200)
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

/** HTTP-проверки не запускают Chrome; browser-сценарии явно внедряют свой adapter. */
function startTestServer(options: Omit<Parameters<typeof startExternalStorybookServer>[0], "createWeb">) {
  return startExternalStorybookServer({createWeb, browserLifecycle: fakeBrowserLifecycle().service, ...options})
}

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

/** Временные entrypoints входят в root compiler, но не в неявный inventory чужих сборок. */
function sharedEntriesDirectory(): string {
  const cache = join(import.meta.dir, "../../../.cache")
  mkdirSync(cache, {recursive: true})
  const root = mkdtempSync(join(cache, "storybook-server-test-"))
  roots.push(root)
  return root
}

function sharedEntriesFixture() {
  const root = sharedEntriesDirectory()
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
  const source = join(import.meta.dir, "../../../repo/discovery/fixtures/valid")
  const workspace = join(root, "workspace")
  mkdirSync(workspace, {recursive: true})
  Bun.spawnSync(["cp", "-R", `${source}/.`, workspace])
  for (const [path, title] of [
    ["index.ts", "Fixture workspace"],
    ["projects/alpha/index.ts", "Fixture Alpha"],
    ["projects/alpha/packages/components/index.ts", "Fixture Components"],
    ["standalone/index.ts", "Standalone"],
  ] as const) writeFileSync(join(workspace, path), `/**\n# ${title}\n@packageDocumentation\n*/\n`)
  const standalone = join(root, "standalone")
  Bun.spawnSync(["cp", "-R", join(workspace, "standalone"), standalone])
  rmSync(join(workspace, "standalone"), {recursive: true})
  const entries = sharedEntriesDirectory()
  const landingEntry = join(entries, "landing-entry.ts")
  const fallbackEntry = join(entries, "fallback-entry.ts")
  const packageEntry = join(entries, "package-entry.ts")
  writeFileSync(landingEntry, "document.documentElement.dataset.fixtureLanding = 'ready'\n")
  writeFileSync(fallbackEntry, "document.documentElement.dataset.fixtureFallback = 'ready'\n")
  writeFileSync(packageEntry, "export default async function startExternalStorybookPackage() {}\n")
  return Object.freeze({
    root,
    workspace,
    standalone,
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

async function controlPost(server: AppServer.Output, path: string, body: unknown) {
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

/** Публикует подготовленную оболочку перед проверкой публичной страницы, сохраняя ревизии пакетов. */
async function publishTestShared(server: AppServer.Output): Promise<void> {
  const published = await controlPost(server, "/api/control/check", {scope: "storybook:shared", live: true})
  expect(published.body, JSON.stringify(published.body)).toMatchObject({ok: true, published: true})
}

async function controlGet(server: AppServer.Output, path: string): Promise<any> {
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
