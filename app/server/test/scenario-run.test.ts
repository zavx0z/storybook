import ArchetypesScenarioReaderOwner from "@archetypes/scenario-reader"
import {type AppServerCatalog as AppServerCatalogContract} from "@app-server/catalog"
import {type AppServerSessions as AppServerSessionsContract} from "@app-server/sessions"
const readScenario = ArchetypesScenarioReaderOwner
type ExternalStorybookRegistrySnapshot = ReturnType<AppServerCatalogContract.Output["snapshot"]>
type ExternalStorybookSessionManager = AppServerSessionsContract.Output
import {expect, test} from "bun:test"
import {mkdtemp, mkdir, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import {createStorybookScenarioRunner} from "../src/scenario-run"

test("Сервер выполняет настоящий компонентный тест и возвращает проверенные props", async () => {
  const path = resolve(import.meta.dir, "../../../specs/scenarios/reader/spec/fixture/component/spec/scenario.spec.tsx")
  const prepared = await readScenario({path})
  if (prepared.preview?.kind !== "component") throw new Error("Нет компонентного сценария")
  const root = await mkdtemp(resolve(tmpdir(), "storybook-component-run-"))
  const nodeId = "component:command"
  const packageId = "@fixture/scenario-component"
  try {
    await mkdir(resolve(root, "scenarios"))
    await Bun.write(resolve(root, "scenarios", `${encodeURIComponent(nodeId)}.json`), JSON.stringify(prepared))
    const snapshot = {graph: {nodes: [{id: nodeId, packageId, scenarioSpec: {sourcePaths: [prepared.path]}}]}} as unknown as ExternalStorybookRegistrySnapshot
    const sessions = {session: () => ({revisionDirectory: () => root, revisionInputsMatch: () => true})} as unknown as ExternalStorybookSessionManager
    const run = createStorybookScenarioRunner()
    const input = {nodeId, revision: "revision", variantId: prepared.preview.variants[1]!.id,
      props: {label: "Проверено", disabled: true}}
    const result = await run(input, packageId, snapshot, sessions, new AbortController().signal)
    expect(result.execution.status).toBe("passed")
    expect(result.props).toEqual({label: "Проверено", disabled: true})
    expect(result.execution.tests.every(test => test.status === "passed")).toBeTrue()
    const failed = await run({...input, props: {label: 123, disabled: true}}, packageId, snapshot, sessions, new AbortController().signal)
    expect(failed.execution.status).toBe("failed")
    expect(failed.execution.tests.some(test => test.status === "failed")).toBeTrue()
  } finally {
    await rm(root, {recursive: true, force: true})
  }
}, 30_000)

/** Две группы в отчёте одной ревизии; проверки первой темы вложены в её вариант. */
async function cachedFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "storybook-cached-run-"))
  const nodeId = "directory:fixture/scenario"
  const packageId = "@fixture/cached"
  const source = resolve(root, "scenario.spec.ts")
  const prepared = {
    path: source, exitCode: 0, source: {text: "scenario"}, calls: [],
    groups: [{id: 0, parentId: null}, {id: 1, parentId: 0}, {id: 2, parentId: null}],
    tests: [
      {id: 0, groupId: 1, label: "Вложенная проверка", status: "passed", message: null},
      {id: 1, groupId: 2, label: "Другой вариант", status: "passed", message: null},
    ],
    preview: {kind: "function", variants: [
      {id: "0", title: "Первый", props: {value: 1}, source: "first()", calls: [], points: []},
      {id: "2", title: "Второй", props: {value: 2}, source: "second()", calls: [], points: []},
    ]},
  } as unknown as Awaited<ReturnType<typeof readScenario>>
  await mkdir(resolve(root, "scenarios"))
  await Bun.write(resolve(root, "scenarios", `${encodeURIComponent(nodeId)}.json`), JSON.stringify(prepared))
  let current = true
  const snapshot = {graph: {nodes: [{id: nodeId, packageId, scenarioSpec: {sourcePaths: [source]}}]}} as unknown as ExternalStorybookRegistrySnapshot
  const sessions = {session: () => ({revisionDirectory: () => root, revisionInputsMatch: () => current,
    snapshot: () => ({diagnostics: [{message: "Ошибка компиляции нового сценария"}]})})} as unknown as ExternalStorybookSessionManager
  const report = (): typeof prepared => ({...prepared, tests: [prepared.tests[0]!],
    preview: {...prepared.preview!, variants: [prepared.preview!.variants[0]!]} as NonNullable<typeof prepared.preview>})
  return {packageId, snapshot, sessions, report,
    input: {nodeId, revision: "revision", variantId: "0", props: {value: 1}},
    changeInputs() { current = false },
    dispose: () => rm(root, {recursive: true, force: true}),
  }
}

test("Отчёт сборки возвращает выбранную тему без нового теста, включая показ lastWorking", async () => {
  const fixture = await cachedFixture()
  let executions = 0
  const run = createStorybookScenarioRunner(async () => { executions++; return fixture.report() })
  try {
    const result = await run(fixture.input, fixture.packageId, fixture.snapshot, fixture.sessions, new AbortController().signal)
    expect(result.execution.tests.map(test => test.label)).toEqual(["Вложенная проверка"])
    expect(result.execution.status).toBe("passed")
    fixture.changeInputs()
    expect(await run(fixture.input, fixture.packageId, fixture.snapshot, fixture.sessions, new AbortController().signal)).toEqual(result)
    expect(executions, "Сохранённый результат относится к отображаемой ревизии даже при ошибке нового HMR").toBe(0)
    await expect(run({...fixture.input, rerun: true}, fixture.packageId, fixture.snapshot, fixture.sessions,
      new AbortController().signal)).rejects.toThrow("Ошибка компиляции нового сценария")
    expect(executions).toBe(0)
  } finally { await run.dispose(); await fixture.dispose() }
})

test("Одинаковые запросы разделяют прогон; отмена читателя не отменяет второго", async () => {
  const fixture = await cachedFixture()
  const entered = Promise.withResolvers<void>()
  const complete = Promise.withResolvers<void>()
  let executions = 0
  const run = createStorybookScenarioRunner(async input => {
    executions++
    entered.resolve()
    await complete.promise
    input.signal!.throwIfAborted()
    return fixture.report()
  })
  const input = {...fixture.input, props: {value: 3}}
  const first = new AbortController()
  try {
    const canceled = run(input, fixture.packageId, fixture.snapshot, fixture.sessions, first.signal).catch(error => error)
    await entered.promise
    const second = run(input, fixture.packageId, fixture.snapshot, fixture.sessions, new AbortController().signal)
    first.abort(new Error("Читатель выбрал другой вариант"))
    complete.resolve()
    expect(await canceled).toBeInstanceOf(Error)
    const result = await second
    expect(result.execution.status).toBe("passed")
    expect(await run(input, fixture.packageId, fixture.snapshot, fixture.sessions, new AbortController().signal)).toEqual(result)
    expect(executions).toBe(1)
    await run({...input, revision: "next"}, fixture.packageId, fixture.snapshot, fixture.sessions, new AbortController().signal)
    expect(executions, "Новая ревизия не использует прогон изменённых параметров старой").toBe(2)
  } finally { complete.resolve(); await run.dispose(); await fixture.dispose() }
})

test("Неудачный тест сохраняется; явный повтор и другие props требуют нового прогона", async () => {
  const fixture = await cachedFixture()
  let executions = 0
  const run = createStorybookScenarioRunner(async () => {
    executions++
    const report = fixture.report()
    return {...report, exitCode: 1, tests: [{...report.tests[0]!, status: "failed", message: "Ожидание нарушено"}]}
  })
  const invoke = (input: typeof fixture.input & {rerun?: boolean}) =>
    run(input, fixture.packageId, fixture.snapshot, fixture.sessions, new AbortController().signal)
  try {
    const input = {...fixture.input, props: {value: 3}}
    expect((await invoke(input)).execution.status).toBe("failed")
    expect((await invoke(input)).execution.tests[0]?.message).toBe("Ожидание нарушено")
    expect(executions).toBe(1)
    await invoke({...input, rerun: true})
    await invoke({...input, props: {value: 4}})
    expect(executions).toBe(3)
  } finally { await run.dispose(); await fixture.dispose() }
})

test("Изменение входов во время прогона и незавершённые проверки не сохраняют результат", async () => {
  const fixture = await cachedFixture()
  let executions = 0
  const run = createStorybookScenarioRunner(async () => {
    executions++
    const report = fixture.report()
    if (executions === 3) fixture.changeInputs()
    return {...report, tests: [{...report.tests[0]!, status: executions < 3 ? "not-executed" : "passed"}]}
  })
  const input = {...fixture.input, props: {value: 3}}
  const invoke = () => run(input, fixture.packageId, fixture.snapshot, fixture.sessions, new AbortController().signal)
  try {
    await invoke()
    await invoke()
    expect(executions, "Неполный отчёт требует нового выполнения").toBe(2)
    await expect(invoke()).rejects.toThrow("Ошибка компиляции нового сценария")
    await expect(invoke()).rejects.toThrow("Ошибка компиляции нового сценария")
    expect(executions, "После изменения входов старое исполнение не повторяется").toBe(3)
  } finally { await run.dispose(); await fixture.dispose() }
})
