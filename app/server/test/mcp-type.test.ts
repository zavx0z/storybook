import {afterEach, expect, test} from "bun:test"
import {mkdtemp, readFile, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import storybookRest from "@zavx0z/storybook-app-mcp-rest"
import type {Zavx0zStorybookPackageSession} from "@zavx0z/storybook-package-session"
import type {Zavx0zStorybookAppServerCatalog} from "@zavx0z/storybook-app-server-catalog"
import {readMcpEntityType} from "../src/mcp-type"
import storybookMcpEntries from "@zavx0z/storybook-package-mcp-source"

type Snapshot = ReturnType<Zavx0zStorybookAppServerCatalog.Output["snapshot"]>
const releases: (() => Promise<void>)[] = []
afterEach(async () => { for (const release of releases.splice(0)) await release() })
const types = ["Repo", "Component", "Container", "Cluster", "Domain"] as const
const scenario = resolve(import.meta.dir, "../../../package/reader/spec/scenario.spec.ts")

async function fixture(type: typeof types[number] = "Component") {
  const directory = await mkdtemp(join(tmpdir(), "storybook-mcp-type-"))
  releases.push(() => rm(directory, {recursive: true, force: true}))
  const graph = {packageId: "@fixture/owner", packageGraphDigest: "current-graph", declarationDigest: "current-declaration"}
  const descriptor = {packageId: "@fixture/owner", packageRoot: directory, declarationDigest: graph.declarationDigest, graphSnapshot: graph}
  const snapshot = {descriptors: [descriptor]} as unknown as Snapshot
  const state = {
    buildState: "active", activeRevision: "verified" as string | null, builtRevision: null as string | null,
    lastWorkingRevision: null as string | null, candidateRevision: null as string | null, diagnostics: [],
    revisions: [{revision: "verified", status: "working"}],
  }
  let released = 0
  const session = {descriptor, snapshot: () => state, revisionGraphSnapshot: () => graph, revisionDirectory: () => directory,
    acquireRevisionLease: () => ({release: () => { released += 1 }}),
  } as unknown as Zavx0zStorybookPackageSession.Output
  const sessions = {session: () => session}
  const groups = [
    {id: 0, parentId: null, label: "Архетип пакета", mode: "run", parameters: {props: {path: directory}}},
    ...types.map((label, index) => ({id: index + 1, parentId: 0, label, mode: label === type ? "run" : "skip"})),
    {id: 6, parentId: 0, label: "Общие требования", mode: "run"},
  ]
  const report = {
    path: scenario, source: {text: await readFile(scenario, "utf8")}, exitCode: 0, stderr: "", groups,
    tests: groups.slice(1).map(group => ({id: group.id, groupId: group.id, status: group.mode === "run" ? "passed" : "skipped",
      skipReason: group.mode === "skip" ? "Другой архетип" : null, location: {path: scenario}})),
    assertions: [], validation: {checks: []},
  }
  await Bun.write(join(directory, "verification.json"), JSON.stringify(report))
  return {directory, graph, descriptor, snapshot, state, sessions, session, report, released: () => released}
}

test.each([...types])("сохранённый отчёт → %s → собственный MCP", async type => {
  const f = await fixture(type)
  const node = {id: "package:fixture", packageId: "@fixture/owner", kind: "package", urlPath: "/example/owner",
    label: "Владелец", parentId: null, source: {path: join(f.directory, "package.json")}}
  const snapshot = {...f.snapshot, catalog: {scopes: []}, graph: {nodes: [node]}} as unknown as Snapshot
  const entries = storybookMcpEntries(snapshot, id => readMcpEntityType(id, f.sessions))
  const response = await storybookRest(new Request("http://localhost", {method: "POST", body: JSON.stringify({path: "example/owner"})}), {
    projectName: "Project", entries,
  })
  expect(await response.json()).toEqual({path: "example/owner", label: "Владелец", children: [],
    description: "Описание не задано владельцем.", verification: {status: "confirmed", type, revision: "verified"}})
  expect(f.released()).toBe(1)
})

test("изменение описания в каталоге не отменяет отчёт рабочей ревизии", async () => {
  const f = await fixture()
  f.descriptor.graphSnapshot = {...f.graph, packageGraphDigest: "new-graph"}
  f.descriptor.declarationDigest = "new-declaration"
  expect(await readMcpEntityType("@fixture/owner", f.sessions))
    .toEqual({status: "confirmed", type: "Component", revision: "verified"})
})

test.each(["queued", "compiling", "failed"])("состояние новой подготовки %s сохраняет рабочую ревизию", async buildState => {
  const f = await fixture()
  f.state.buildState = buildState
  f.state.candidateRevision = "new-candidate"
  expect(await readMcpEntityType("@fixture/owner", f.sessions))
    .toEqual({status: "confirmed", type: "Component", revision: "verified"})
})

test.each(["queued", "compiling", "failed"])("без рабочей ревизии сохраняется состояние %s", async buildState => {
  const f = await fixture()
  f.state.activeRevision = null
  f.state.buildState = buildState
  expect(await readMcpEntityType("@fixture/owner", f.sessions))
    .toEqual({status: "unknown", reason: buildState === "failed" ? "failed" : "incomplete"})
})

test("готовый кандидат не заменяет применённую рабочую ревизию", async () => {
  const f = await fixture()
  f.state.builtRevision = "new-candidate"
  expect(await readMcpEntityType("@fixture/owner", f.sessions))
    .toEqual({status: "confirmed", type: "Component", revision: "verified"})
})

test("без применённой версии используется последняя рабочая, затем готовая", async () => {
  const f = await fixture()
  f.state.activeRevision = null
  f.state.lastWorkingRevision = "verified"
  expect(await readMcpEntityType("@fixture/owner", f.sessions))
    .toEqual({status: "confirmed", type: "Component", revision: "verified"})
  f.state.lastWorkingRevision = null
  f.state.builtRevision = "verified"
  f.state.revisions[0]!.status = "built"
  expect(await readMcpEntityType("@fixture/owner", f.sessions))
    .toEqual({status: "confirmed", type: "Component", revision: "verified"})
})

test("отсутствующий и повреждённый отчёт не подтверждают тип", async () => {
  const f = await fixture()
  await rm(join(f.directory, "verification.json"))
  expect(await readMcpEntityType("@fixture/owner", f.sessions)).toEqual({status: "unknown", reason: "missing-report", revision: "verified"})
  await Bun.write(join(f.directory, "verification.json"), "{")
  expect(await readMcpEntityType("@fixture/owner", f.sessions)).toEqual({status: "unknown", reason: "invalid-report", revision: "verified"})
})

test("TODO сохраняется в отчёте и не блокирует выбранный предметный MCP", async () => {
  const f = await fixture()
  f.report.tests[5]!.status = "todo"
  await Bun.write(join(f.directory, "verification.json"), JSON.stringify(f.report))
  expect(await readMcpEntityType("@fixture/owner", f.sessions))
    .toEqual({status: "confirmed", type: "Component", revision: "verified"})
  expect((await Bun.file(join(f.directory, "verification.json")).json()).tests[5].status).toBe("todo")
})

test("директория и средовой вход не наследуют тип пакета", async () => {
  const f = await fixture("Domain")
  const snapshot = {...f.snapshot, catalog: {scopes: []}, graph: {nodes: [
    {id: "directory", packageId: "@fixture/owner", kind: "directory", urlPath: "/example/owner/docs", label: "Документы", parentId: null, source: {path: f.directory}},
    {id: "entry", packageId: "@fixture/owner", kind: "entry", urlPath: "/example/owner/web.ts", label: "Web", parentId: null, source: {path: join(f.directory, "web.ts")}},
  ]}} as unknown as Snapshot
  let reads = 0
  const entries = storybookMcpEntries(snapshot, async () => {
    reads += 1
    return {status: "confirmed", type: "Domain"}
  })
  expect(entries.every(entry => entry.readType === undefined)).toBeTrue()
  expect(reads).toBe(0)
})

test("смена ревизии во время чтения не публикует прежнее подтверждение", async () => {
  const f = await fixture()
  const result = readMcpEntityType("@fixture/owner", f.sessions)
  f.state.activeRevision = "new-revision"
  expect(await result).toEqual({status: "unknown", reason: "stale-report", revision: "verified"})
  expect(f.released()).toBe(1)
})

test("ошибка выбранного отчёта и чужая ревизия не подтверждают тип", async () => {
  const f = await fixture()
  f.report.exitCode = 1
  await Bun.write(join(f.directory, "verification.json"), JSON.stringify(f.report))
  expect(await readMcpEntityType("@fixture/owner", f.sessions)).toEqual({status: "unknown", reason: "failed", revision: "verified"})
  f.graph.packageId = "@fixture/other"
  expect(await readMcpEntityType("@fixture/owner", f.sessions)).toEqual({status: "unknown", reason: "invalid-report", revision: "verified"})
})
