/**
Проверяет наблюдение public exports в отдельном запуске Bun Test.

@packageDocumentation
*/
import {beforeAll, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario} from "../index"
import type {ReadScenarioOutput} from "../index"

const fixturePath = resolve(import.meta.dir, "fixture/trace-scenario.test.ts")
const fixtureModule = resolve(import.meta.dir, "fixture/trace-functions.ts")
const packageScenarioPath = resolve(import.meta.dir, "../../../package/spec/scenario.spec.ts")
let fixture: ReadScenarioOutput
let packageScenario: ReadScenarioOutput

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
    {describe: ["Первый вариант"], test: null, args: ["each-one", 1]},
    {describe: ["Второй вариант"], test: null, args: ["each-two", 1]},
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

test("неизменённый package scenario даёт две группы readPackage", () => {
  expect(packageScenario.calls).toMatchObject([
    {
      name: "readPackage",
      describe: ["Корневой пакет"],
      test: null,
      args: [{path: resolve(import.meta.dir, "../../..")}],
      outcome: {type: "resolve", value: {packageJson: {name: "@storybook/archetypes"}}},
    },
    {
      name: "readPackage",
      describe: ["Вложенный пакет"],
      test: null,
      args: [{path: resolve(import.meta.dir, "../..")}],
      outcome: {type: "resolve", value: {packageJson: {name: "@archetypes/specs"}}},
    },
  ])
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

test("полная история имеет читаемый snapshot", () => {
  expect({
    fixture: fixture.calls.map(({id, location, ...call}) => ({...call, location: location && {
      path: location.path.replace(resolve(import.meta.dir, "../../../.."), "<archetypes>"),
      line: location.line,
      column: location.column,
    }})),
    packageScenario: packageScenario.calls.map(({id, location, ...call}) => ({...call, location: location && {
      path: location.path.replace(resolve(import.meta.dir, "../../../.."), "<archetypes>"),
      line: location.line,
      column: location.column,
    }})),
  }).toMatchSnapshot()
})
