import {afterEach, expect, spyOn, test} from "bun:test"
import {mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import Registry from "@app-server/catalog"
import discover from "@repo/discovery"
import type {AppServer} from "../contract"
import createWeb from "@app/web"
import {refreshCheckCatalog} from "../src/check-catalog"
import {createCatalogRefresh} from "../src/catalog-refresh"
import {createProjectFixture} from "./project.fixture"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "scoped-check-catalog-")))
  roots.push(root)
  const owner = (name: string) => {
    const directory = join(root, name)
    mkdirSync(directory)
    writeFileSync(join(directory, "package.json"), JSON.stringify({name: `@fixture/${name}`, type: "module",
      exports: {".": "./index.ts"}}))
    writeFileSync(join(directory, "index.ts"), `/** ${name} before\n@packageDocumentation\n*/\nexport const value = 1\n`)
    return directory
  }
  return {root, selected: owner("selected"), unrelated: owner("unrelated"), shared: owner("shared")}
}

test("scoped refresh читает выбранный пакет и его импорт, сохраняет соседний; полный refresh обновляет всех", async () => {
  const f = fixture()
  mkdirSync(join(f.selected, "contract"))
  mkdirSync(join(f.shared, "contract"))
  const shared = join(f.shared, "contract/index.ts")
  writeFileSync(shared, "export declare namespace Shared { type Input = { value: string } }\n")
  writeFileSync(join(f.selected, "contract/index.ts"),
    'import type {Shared} from "../../shared/contract"\nexport declare namespace Selected { type Input = Shared.Input }\n')
  const scopes: Array<readonly string[] | undefined> = []
  const registry = new Registry(async (inputs, previous, options) => {
    scopes.push(options?.dirtyScopeRoots)
    return discover(inputs, previous, options)
  })
  await registry.configure([f.selected, f.unrelated, f.shared])
  const before = registry.snapshot().catalog.scopes.find(scope => scope.id === "@fixture/unrelated")!
  const refresh = createCatalogRefresh(force => force ? registry.refresh() : registry.refreshIfNeeded())
  const select = (_snapshot: ReturnType<Registry["snapshot"]>, scope: string | null) => [scope!]
  writeFileSync(join(f.selected, "index.ts"), "/** selected after\n@packageDocumentation\n*/\nexport const value = 2\n")
  writeFileSync(join(f.unrelated, "index.ts"), "/** unrelated after\n@packageDocumentation\n*/\nexport const value = 3\n")
  writeFileSync(shared, "export declare namespace Shared { type Input = { value: number } }\n")
  mkdirSync(join(f.selected, "extra"))
  writeFileSync(join(f.selected, "extra/index.ts"), "/** Новый вход\n@packageDocumentation\n*/\nexport const extra = true\n")
  writeFileSync(join(f.selected, "package.json"), JSON.stringify({name: "@fixture/selected", type: "module",
    exports: {".": "./index.ts", "./extra": "./extra/index.ts"}}))
  const next = await refreshCheckCatalog("@fixture/selected", registry, refresh, select)
  const selected = next.catalog.scopes.find(scope => scope.id === "@fixture/selected")!
  const unrelated = next.catalog.scopes.find(scope => scope.id === "@fixture/unrelated")!
  expect(scopes[1]).toEqual([f.selected])
  expect(selected.resolutionError).toBeUndefined()
  expect(JSON.stringify(selected)).toContain("selected after")
  expect(JSON.stringify(selected)).toContain("Новый вход")
  expect(JSON.stringify(selected)).toContain('"type":"number"')
  expect(unrelated.kind === "package" && before.kind === "package" && unrelated.directories === before.directories,
    "Структура несвязанного владельца не перечитывается").toBeTrue()
  expect(JSON.stringify(unrelated)).not.toContain("unrelated after")
  writeFileSync(shared, "export declare namespace Shared { type Input = { value: boolean } }\n")
  const changedDependency = await refreshCheckCatalog("@fixture/selected", registry, refresh, select)
  expect(JSON.stringify(changedDependency.catalog.scopes.find(scope => scope.id === "@fixture/selected")),
    "Изменение импортированного типа видно без изменения package.json выбранного пакета").toContain('"type":"boolean"')
  const all = await refreshCheckCatalog(null, registry, refresh, select)
  expect(scopes[3], "Полное обновление не ограничивает dirtyScopeRoots").toBeUndefined()
  expect(JSON.stringify(all.catalog.scopes.find(scope => scope.id === "@fixture/unrelated"))).toContain("unrelated after")
}, 30_000)

test("неизвестная область сначала обновляет полный состав каталога", async () => {
  const calls: boolean[] = []
  const registry = new Registry(async () => ({schemaVersion: 1, rootIds: [], scopes: []}))
  await refreshCheckCatalog("@fixture/new", registry, async force => {
    calls.push(force === true)
    return registry.snapshot()
  }, () => { throw new Error("Unknown Storybook check scope: @fixture/new") })
  expect(calls).toEqual([true])
})

test("область родителя сохраняет выбранных потомков и не обновляет соседний Repo", async () => {
  const f = fixture()
  const child = join(f.selected, "children/child")
  mkdirSync(child, {recursive: true})
  writeFileSync(join(f.selected, "package.json"), JSON.stringify({name: "@fixture/selected", workspaces: ["children/*"]}))
  writeFileSync(join(child, "package.json"), JSON.stringify({name: "@fixture/child"}))
  writeFileSync(join(child, "index.ts"), "/** До изменения\n@packageDocumentation\n*/\nexport const child = 1\n")
  const scopes: Array<readonly string[] | undefined> = []
  const registry = new Registry(async (inputs, previous, options) => {
    scopes.push(options?.dirtyScopeRoots)
    return discover(inputs, previous, options)
  })
  await registry.configure([f.selected, f.unrelated])
  writeFileSync(join(child, "index.ts"), "/** Новый код потомка\n@packageDocumentation\n*/\nexport const child = 2\n")
  const refresh = createCatalogRefresh(force => force ? registry.refresh() : registry.refreshIfNeeded())
  const next = await refreshCheckCatalog("package:@fixture/selected", registry, refresh, snapshot => {
    const entry = snapshot.entries.find(entry => entry.canonicalId === "package:@fixture/selected")!
    return snapshot.graph.nodes.filter(node => node.kind === "package" && entry.descendantIds.includes(node.id))
      .map(node => node.packageId!)
  })
  expect(scopes[1]).toEqual([f.selected, child])
  expect(JSON.stringify(next.catalog.scopes.find(scope => scope.id === "@fixture/child"))).toContain("Новый код потомка")
})

test("закрытие ожидания во время refresh не отменяет принятую сборку и не применяет её поздно", async () => {
  const f = fixture()
  const refreshEntered = Promise.withResolvers<void>()
  const refreshGate = Promise.withResolvers<void>()
  const completed = Promise.withResolvers<void>()
  const callers: string[] = []
  let waiting = false
  let browserCalls = 0
  let running: AppServer.Output | undefined
  let unsubscribe = () => {}
  const prepare = await import("@package-build/prepare")
  const original = prepare.default
  const factory = spyOn(prepare, "default").mockImplementation(() => async input => {
    expect(input.signal.aborted, "Сборкой владеет session, не закрывшийся HTTP-наблюдатель").toBeFalse()
    callers.push(input.descriptor.packageId)
    writeFileSync(join(input.stagingDirectory, "entry.js"), "export {}\n")
    return {moduleGraphRevision: "accepted-check", dependencyRealpaths: [], entryRelativePath: "entry.js"}
  })
  try {
    const {default: startServer} = await import("../index")
    const unavailable = async () => { browserCalls += 1; throw new Error("Закрытый запрос не применяет результат") }
    const entry = join(f.root, "browser.ts")
    writeFileSync(entry, "export default function start() {}\n")
    running = await startServer({
      createWeb,
      project: createProjectFixture(f.root, [f.selected, f.unrelated]),
      statePath: join(f.root, "state.json"),
      artifactRoot: join(f.root, "artifacts"),
      packageBrowserEntryPath: entry,
      resolveCatalog: async (...args) => {
        if (waiting) { refreshEntered.resolve(); await refreshGate.promise }
        return discover(...args)
      },
      browserLifecycle: {
        openPackage: unavailable, listViews: unavailable, inspect: unavailable,
        interact: unavailable, capture: unavailable, close: unavailable,
        readCapture() { throw new Error("Нет снимков") },
        getView() { throw new Error("Нет представлений") },
      },
    })
    unsubscribe = running.sessions.buildScheduler.subscribe(event => {
      if (event.packageId === "@fixture/selected" && event.state === "completed") completed.resolve()
    })
    waiting = true
    const abort = new AbortController()
    const response = await fetch(new URL("/api/control/check", running.origin), {
      method: "POST", signal: abort.signal,
      headers: {authorization: `Bearer ${running.record.controlToken}`, "content-type": "application/json", accept: "application/x-ndjson"},
      body: JSON.stringify({scope: "@fixture/selected"}),
    })
    await refreshEntered.promise
    abort.abort()
    await response.body?.cancel().catch(() => {})
    refreshGate.resolve()
    await completed.promise
    // Завершение scheduler предшествует записи результата session на один async continuation.
    await running.sessions.ensure("@fixture/selected")
    expect(callers).toEqual(["@fixture/selected"])
    expect(running.sessions.session("@fixture/selected").snapshot().buildState).toBe("built")
    expect(browserCalls).toBe(0)
  } finally {
    refreshGate.resolve()
    unsubscribe()
    await running?.stop()
    factory.mockImplementation(original)
    factory.mockRestore()
  }
}, 15_000)
