import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario} from "@storybook/app/scenarios"
import {createFunctionPreview, inspectFunctionScenario} from "../src/function-preview.ts"

const path = "/fixture/spec/scenario.spec.ts"
const module = "/fixture/index.ts"
const location = {path, line: 1, column: 1}
const descriptor: Parameters<typeof createFunctionPreview>[0] = {
  path,
  module,
  export: "evaluate",
  local: "evaluate",
  importSource: 'import {evaluate} from "@fixture/function"',
  locations: [{line: 1, column: 1, propsArgumentIndexes: []}],
  referencesByVariant: [[]],
}

/** Граница preview получает также повреждённые raw значения; фактический вызов не исполняется повторно. */
function execution(input: unknown): Parameters<typeof createFunctionPreview>[1] {
  return {
    path,
    exitCode: 0,
    stdout: "",
    stderr: "",
    junit: "",
    assertions: [],
    tests: [],
    groups: [{id: 1, parentId: null, label: "Значение", parameters: {}, location, mode: "run", skipReason: null}],
    calls: [{
      id: 1,
      completed: 1,
      module,
      name: "evaluate",
      groupId: 1,
      describe: ["Значение"],
      test: null,
      args: [input as never],
      outcome: {type: "return", value: null},
      location,
    }],
  }
}

describe.each([
  {name: "raw undefined", value: undefined},
  {name: "raw function", value: () => undefined},
  {name: "raw symbol", value: Symbol("native")},
  {name: "raw bigint", value: 1n},
  {name: "вложенное raw undefined", value: {snapshot: {value: undefined}}},
])("$name", ({value}) => {
  test("непереносимые данные не создают preview и не прерывают обработку", () => {
    expect(createFunctionPreview(descriptor, execution(value))).toBeUndefined()
  })
})

test("encoded undefined остаётся исходным TypeScript значением", () => {
  const preview = createFunctionPreview(descriptor, execution({$type: "undefined"}))
  expect(preview?.variants[0]?.calls[0]?.source).toBe("evaluate(undefined)")
})

test("native подготовка сохраняется целиком с одной переносимой строкой each", async () => {
  const path = resolve(import.meta.dir, "../../../../webxr-space/jsx/slot/contract/spec/scenario.spec.ts")
  const report = await readScenario({
    path,
    variant: 0,
  })
  const call = report.calls.find(call => call.name === "default")
  const descriptor = await inspectFunctionScenario(path)
  if (report.preview?.kind !== "function" || descriptor?.authored === undefined) throw new Error("Нет авторского function preview")
  const variant = report.preview.variants[0]!
  const {text, tableStart, tableEnd} = descriptor.authored
  const before = text.slice(0, tableStart)
  const after = text.slice(tableEnd)
  const table = variant.source.slice(before.length, variant.source.length - after.length)
  expect({
    exitCode: report.exitCode,
    tests: report.tests.map(test => test.status),
    arguments: call?.args.length,
    outcome: call?.outcome.type,
    originalSetup: variant.source.startsWith(before) && variant.source.endsWith(after),
    rows: JSON.parse(table),
    callSource: variant.calls[0]?.source,
    sameOutcome: JSON.stringify(variant.calls[0]?.outcome) === JSON.stringify(call?.outcome),
  }).toEqual({
    exitCode: 0,
    tests: ["passed", "passed", "passed"],
    arguments: 1,
    outcome: "resolve",
    originalSetup: true,
    rows: [{name: "Alias и type-only re-export", props: {file: "alias.tsx"}, warning: false, typeDependencies: true}],
    callSource: "await validateSlotContracts(input)",
    sameOutcome: true,
  })
}, 30_000)

test.each([
  {owner: "runtime", name: "jsx", template: "textTemplate", text: "Содержимое"},
  {owner: "development", name: "jsxDEV", template: "textTemplate", text: "Текст"},
])("native positional protocol $owner сохраняет импорт template", async ({owner, name, template, text}) => {
  const report = await readScenario({
    path: resolve(import.meta.dir, "../../../../webxr-space/jsx", owner, "create/spec/scenario.spec.ts"),
  })
  if (report.preview?.kind !== "function") throw new Error("Нет native protocol preview")
  const variant = report.preview.variants[0]!
  expect({
    exitCode: report.exitCode,
    imported: variant.source.includes('import {' + template + '} from "./fixture/index.ts"'),
    positional: variant.calls[0]?.source.startsWith(name + "(" + template + ", "),
    props: variant.calls[0]?.source.includes('"text": "' + text + '"'),
    sameOutcome: JSON.stringify(variant.calls[0]?.outcome) === JSON.stringify(report.calls.find(call => call.name === "default")?.outcome),
    receiver: owner !== "runtime" || report.preview.variants[2]?.source.includes('import {receiverTemplate} from "./fixture/index.ts"'),
  }).toEqual({exitCode: 0, imported: true, positional: true, props: true, sameOutcome: true, receiver: true})
}, 30_000)
