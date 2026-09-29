import {afterAll, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {prepareStorybookScenarios} from "./package-build"
import type {StorybookPackageBuildDescriptor, StorybookPackageDiagnostic} from "../sessions/package-session"

const roots: string[] = []
afterAll(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}) })

/** Реальное нарушение авторства при исполнимом сценарии, без запуска bundle. */
function fixture(fails = false): StorybookPackageBuildDescriptor {
  const root = mkdtempSync(join(tmpdir(), "scenario-standard-"))
  roots.push(root)
  mkdirSync(join(root, "spec"))
  writeFileSync(join(root, "package.json"), JSON.stringify({name: "@fixture/standard", type: "module", exports: {".": "./index.ts"}}))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({compilerOptions: {target: "ESNext", module: "ESNext", moduleResolution: "Bundler", noEmit: true}}))
  writeFileSync(join(root, "index.ts"), "export function evaluate(props: {value: number}) { return props.value }\n")
  const path = join(root, "spec/scenario.spec.ts")
  writeFileSync(path, [
    'import {describe, expect, test} from "bun:test"',
    'import {evaluate} from "@fixture/standard"',
    'describe.each([{name: "Два вызова", props: {value: 1}}])("$name", ({props}) => {',
    '  const first = evaluate(props)',
    '  const second = evaluate(props)',
    `  test("Результат", () => { expect(first + second, "Реальный результат исполнения").toBe(${fails ? 3 : 2}) })`,
    '})',
  ].join("\n"))
  return {scenarioSpecs: [{nodeId: "scenario", sourcePaths: [path]}]} as unknown as StorybookPackageBuildDescriptor
}

const example = fixture()

test("переходный сценарий сохраняет отчёт и предупреждение вместо ложного preview", async () => {
  const warnings: StorybookPackageDiagnostic[] = []
  const reports: number[] = []
  const preview = await prepareStorybookScenarios(example, new AbortController().signal,
    (_node, report) => reports.push(report.exitCode), {standard: "transition", warnings})
  expect(preview).toEqual([])
  expect(reports).toEqual([0])
  expect(warnings.some(warning => warning.message.includes("single-invocation"))).toBeTrue()
}, 60000)

test("строгий сценарий отклоняет то же нарушение авторства", async () => {
  await expect(prepareStorybookScenarios(example, new AbortController().signal)).rejects.toThrow("single-invocation")
}, 60000)

test("ошибка исполнения переходного сценария остаётся отказом", async () => {
  const path = example.scenarioSpecs![0]!.sourcePaths[0]!
  const source = readFileSync(path, "utf8")
  writeFileSync(path, source.replace(".toBe(2)", ".toBe(3)"))
  try {
    await expect(prepareStorybookScenarios(example, new AbortController().signal,
      undefined, {standard: "transition", warnings: []})).rejects.toThrow("Реальный результат исполнения")
  } finally { writeFileSync(path, source) }
}, 60000)

test("структурный сценарий Domain без исполняемого входа не требует preview", async () => {
  const descriptor = fixture()
  const path = descriptor.scenarioSpecs![0]!.sourcePaths[0]!
  const root = join(path, "../..")
  mkdirSync(join(root, "child"))
  writeFileSync(join(root, "index.ts"), "export {}\n")
  writeFileSync(join(root, "package.json"), JSON.stringify({name: "@fixture/standard", type: "module", exports: {".": "./index.ts", "./child": "./child/index.ts"}}))
  writeFileSync(join(root, "child/index.ts"), "export function read(props: {value: number}) { return props.value }\n")
  writeFileSync(path, [
    'import {describe, expect, test} from "bun:test"',
    'import {read} from "@fixture/standard/child"',
    'describe.each([{name: "Дочерний вход", props: {value: 1}}])("$name", ({props}) => {',
    '  const result = read(props)',
    '  test("Чтение", () => { expect(result, "Домен раскрывает публичный вход дочернего владельца").toBe(1) })',
    '})',
  ].join("\n"))
  const warnings: StorybookPackageDiagnostic[] = []
  let completed = false
  expect(await prepareStorybookScenarios(descriptor, new AbortController().signal,
    (_node, report) => { completed = report.exitCode === 0 }, {standard: "strict", warnings})).toEqual([])
  expect(completed).toBeTrue()
  expect(warnings).toEqual([])
}, 60000)
