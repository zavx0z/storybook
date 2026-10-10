/**
Проверяет наблюдение public exports в отдельном запуске Bun Test.

@packageDocumentation
*/
import {beforeAll, expect, test} from "bun:test"
import {resolve} from "node:path"
import readScenario from "../index"
import type {StorybookSpecsScenariosReader} from "../index"
import {snapshotPath} from "../../../../tests/fixture/snapshot-paths"
import {readImports} from "../src/imports"

const fixturePath = resolve(import.meta.dir, "fixture/trace-scenario.test.ts")
const fixtureModule = resolve(import.meta.dir, "fixture/trace-functions.ts")
const packageScenarioPath = resolve(import.meta.dir, "../../../../package/reader/spec/scenario.spec.ts")
const packageModule = resolve(import.meta.dir, "../../../../package/reader/index.ts")
const manifestModule = resolve(import.meta.dir, "../../../../package/package-json/index.ts")
const contractModule = resolve(import.meta.dir, "../../../../contracts/index.ts")
const ignoredModule = resolve(import.meta.dir, "../../../../package/route/ignored/index.ts")
const readerModule = resolve(import.meta.dir, "../index.ts")
let fixture: StorybookSpecsScenariosReader.Output
let packageScenario: StorybookSpecsScenariosReader.Output

beforeAll(async () => {
  [fixture, packageScenario] = await Promise.all([
    readScenario({
      path: fixturePath,
    }),
    readScenario({
      path: packageScenarioPath,
    }),
  ])
}, 30_000)

test("оба дочерних сценария исполняются настоящим Bun Test", () => {
  expect([fixture.exitCode, packageScenario.exitCode]).toEqual([0, 0])
})

test("обычный describe сохраняет вызов до регистрации test", () => {
  expect(fixture.calls.find(call => call.args[0] === "describe")).toMatchObject({
    describe: ["Обычная группа"],
    test: null,
  })
})

test("describe.each сохраняет фактические названия и аргументы вариантов", () => {
  expect(fixture.calls.filter(call => String(call.args[0]).startsWith("each-"))).toMatchObject([
    {groupId: 1, describe: ["Первый вариант"], test: null, args: ["each-one", 1]},
    {groupId: 2, describe: ["Второй вариант"], test: null, args: ["each-two", 1]},
  ])
})

test("test без describe получает только имя test", () => {
  expect(fixture.calls.find(call => call.args[0] === "root")).toMatchObject({
    describe: [],
    test: "test без describe",
  })
})

test("перекрывающиеся concurrent tests не смешивают принадлежность вызовов", () => {
  expect(fixture.calls.filter(call => call.name === "overlappingValue")).toMatchObject([
    {describe: ["Параллельные тесты"], test: "медленный", args: ["slow", 30]},
    {describe: ["Параллельные тесты"], test: "быстрый", args: ["fast", 1]},
  ])
})

test("синхронный throw сохраняется отдельно от rejected Promise", () => {
  expect(fixture.calls.filter(call => call.name === "throwValue" || call.name === "rejectValue")
    .map(call => call.outcome.type)).toEqual(["throw", "reject"])
})

test("ошибки содержат завершённые значения", () => {
  expect(fixture.calls.filter(call => call.name === "throwValue" || call.name === "rejectValue")
    .map(call => call.outcome)).toMatchObject([
    {type: "throw", error: {$type: "error", name: "Error", message: "sync:boom"}},
    {type: "reject", error: {$type: "error", name: "Error", message: "async:boom"}},
  ])
})

test("package scenario сохраняет прямой вызов выбранного owner и его структурные данные", () => {
  const direct = packageScenario.calls.filter(call => call.module === packageModule && call.location?.path === packageScenarioPath)
  expect(direct).toHaveLength(1)
  expect(direct[0]).toMatchObject({
      name: "default",
      describe: ["Архетип пакета"],
      test: null,
      args: [{path: resolve(import.meta.dir, "../../../../package/reader")}],
      outcome: {type: "resolve", value: {packageJson: {name: "@zavx0z/storybook-package-reader"}, index: {unchecked: []}}},
  })
  const nested = packageScenario.calls.filter(call => call.module === packageModule && call.location?.path === contractModule)
  expect(nested).toHaveLength(1)
  expect(nested[0]).toMatchObject({describe: ["Архетип пакета"], test: null, args: direct[0]!.args,
    outcome: {type: "resolve", value: {packageJson: {name: "@zavx0z/storybook-package-reader"}, index: {unchecked: []}}}})
})

test("package trace относит dependency calls только к импортированным public owners и сохраняет фактический порядок", async () => {
  const imports = await readImports(packageScenarioPath)
  const allowed = new Map(imports.map(selection => [selection.module, selection.names]))
  for (const call of packageScenario.calls) {
    expect(allowed.has(call.module), `Owner явно импортирован сценарием: ${snapshotPath(call.module)}`).toBe(true)
    expect(allowed.get(call.module) === null || allowed.get(call.module)!.includes(call.name), `Наблюдаемое имя ${call.name} экспортирует этот owner`).toBe(true)
    expect(Array.isArray(call.args)).toBe(true)
    expect(call.outcome.type).toBe("resolve")
  }
  const root = packageScenario.calls.find(call => call.module === packageModule && call.location?.path === packageScenarioPath)!
  const manifest = packageScenario.calls.find(call => call.module === manifestModule && call.location?.path === packageModule)!
  expect(manifest.args).toEqual([{path: resolve(import.meta.dir, "../../../../package/reader/package.json")}])
  expect(manifest.outcome).toMatchObject({type: "resolve", value: {name: "@zavx0z/storybook-package-reader"}})
  expect(manifest.id).toBeGreaterThan(root.id)
  expect(manifest.completed).toBeLessThan(root.completed)
  expect(packageScenario.calls.some(call => call.module === contractModule && call.test === null && call.describe[0] === "Архетип пакета")).toBe(true)
  expect(packageScenario.calls.some(call => call.module === ignoredModule && call.outcome.type === "resolve")).toBe(true)
  const names = packageScenario.calls.filter(call => call.module === readerModule)
  expect(names.map(call => call.test)).toEqual(["Имя директории", "Имя пакета"])
  for (const call of names) {
    expect(call.args[0]).toMatchObject({path: resolve(import.meta.dir, "../../../../package/name/spec/scenario.spec.ts"), variant: 0})
    expect(call.outcome).toMatchObject({type: "resolve", value: {exitCode: 0}})
    expect(call.describe).toEqual(["Архетип пакета", "Именование"])
  }
})

test("Promise identity и this не изменяются обёрткой", () => {
  expect(fixture.calls.filter(call => call.name === "identityPromise" || call.name === "receiverValue")
    .map(call => call.outcome)).toMatchObject([
    {type: "resolve", value: "identity"},
    {type: "return", value: "receiver:value"},
  ])
})

test("аргументы фиксируются до мутации вызванной функцией", () => {
  expect(fixture.calls.find(call => call.name === "mutateValue")?.args).toEqual([{state: "before"}])
})

test("concurrent tests реально перекрываются и завершаются в обратном порядке", () => {
  const calls = fixture.calls.filter(call => call.name === "overlappingValue")
  expect(calls.map(call => call.outcome)).toEqual([
    {type: "resolve", value: {value: "slow", activeAtStart: 1}},
    {type: "resolve", value: {value: "fast", activeAtStart: 2}},
  ])
})

test("быстрый concurrent test завершается раньше начатого первым", () => {
  const calls = fixture.calls.filter(call => call.name === "overlappingValue")
  expect((calls[0]?.id ?? 0) < (calls[1]?.id ?? 0) && (calls[0]?.completed ?? 0) > (calls[1]?.completed ?? 0)).toBeTrue()
})

test("полная история управляемой фикстуры имеет читаемый snapshot", async () => {
  const localPath = snapshotPath
  const snapshot = {
    fixture: fixture.calls.map(({id, location, ...call}) => ({...call, module: localPath(call.module), location: location && {
      path: localPath(location.path),
      line: location.line,
      column: location.column,
    }})),
  }
  expect(snapshot).toStrictEqual(await Bun.file(new URL("./__snapshots__/trace.test.json", import.meta.url)).json())
})
