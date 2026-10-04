import {type StorybookPackageSession as PackageSessionContract} from "@zavx0z/storybook-package-session"
type StorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
type StorybookPackageDiagnostic = ReturnType<PackageSessionContract.Output["snapshot"]>["diagnostics"][number]
import {expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import readScenario from "@zavx0z/storybook-specs-scenarios-reader"
import readSpec from "@zavx0z/storybook-specs-reader"
import prepareStorybookScenarios from "@zavx0z/storybook-package-build-scenarios"

test("готовит один preview только для однозначного поддержанного scenario source", async () => {
  const supported = resolve(
    import.meta.dir,
    "../../../../specs/scenarios/reader/spec/fixture/component/spec/scenario.spec.tsx",
  )
  const functionSource = resolve(import.meta.dir, "../../../../package/reader/spec/scenario.spec.ts")
  const descriptor = {
    scenarioSpecs: [
      {nodeId: "directory:package:@fixture/scenarios/component", sourcePaths: [supported]},
      {nodeId: "package:@zavx0z/storybook-package-reader", sourcePaths: [functionSource]},
    ],
  } as unknown as StorybookPackageBuildDescriptor

  const phases: string[] = []
  const result = await prepareStorybookScenarios(descriptor, new AbortController().signal, undefined, undefined,
    progress => { if (phases.at(-1) !== progress.phase) phases.push(progress.phase) })
  expect(phases).toEqual(["preparing", "running", "reporting", "preparing", "running", "reporting"])

  expect(result.map(item => [item.kind, item.nodeId])).toEqual([
    ["component", "directory:package:@fixture/scenarios/component"],
    ["function", "package:@zavx0z/storybook-package-reader"],
  ])
  expect(result[0]).toMatchObject({module: {
    path: realpathSync(supported),
    export: "ScenarioComponent",
  }})
  expect(result[0]?.variants.map(variant => variant.title)).toEqual(["Доступная команда", "Недоступная команда"])
  expect(result[1]?.variants.map(variant => variant.title)).toEqual(["Архетип пакета"])
  expect(result[1]).not.toHaveProperty("module")
}, 30_000)

test("ошибка неподдержанного scenario остаётся отказом переходного пакета", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "storybook-unsupported-scenario-"))
  const path = resolve(root, "scenario.spec.ts")
  writeFileSync(resolve(root, "package.json"), JSON.stringify({name: "@fixture/unsupported", type: "module"}))
  writeFileSync(resolve(root, "tsconfig.json"), JSON.stringify({compilerOptions: {target: "ESNext", module: "ESNext", moduleResolution: "Bundler", noEmit: true}}))
  writeFileSync(path, 'throw new Error("Этот source нельзя исполнять")\n')
  try {
    const descriptor = {
      scenarioSpecs: [{nodeId: "directory:package:@fixture/unsupported/module", sourcePaths: [path]}],
    } as unknown as StorybookPackageBuildDescriptor

    await expect(prepareStorybookScenarios(descriptor, new AbortController().signal,
      undefined, {standard: "transition", warnings: []})).rejects.toThrow("Этот source нельзя исполнять")
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}, 30000)

test("неоднозначность предупреждает переходный пакет и блокирует строгий", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "storybook-ambiguous-scenario-"))
  mkdirSync(resolve(root, "spec"))
  const supported = resolve(root, "spec/scenario.spec.ts")
  const unsupported = resolve(root, "spec/scenario.spec.tsx")
  writeFileSync(resolve(root, "package.json"), JSON.stringify({name: "@fixture/ambiguous", type: "module", exports: {".": "./index.ts"}}))
  writeFileSync(resolve(root, "tsconfig.json"), JSON.stringify({compilerOptions: {target: "ESNext", module: "ESNext", moduleResolution: "Bundler", noEmit: true}}))
  writeFileSync(resolve(root, "index.ts"), "export function evaluate(props: {value: number}) { return props.value }\n")
  writeFileSync(supported, [
    'import {describe, expect, test} from "bun:test"',
    'import {evaluate} from "@fixture/ambiguous"',
    'describe.each([{name: "Пример", props: {value: 1}}])("$name", ({props}) => {',
    '  const result = evaluate(props)',
    '  test("Значение", () => { expect(result, "Результат публичного вызова").toBe(1) })',
    '})',
  ].join("\n"))
  writeFileSync(unsupported, 'throw new Error("Не выбирать второй сценарий")\n')
  const descriptor = {scenarioSpecs: [{nodeId: "ambiguous", sourcePaths: [supported, unsupported]}]} as unknown as StorybookPackageBuildDescriptor
  const warnings: StorybookPackageDiagnostic[] = []
  try {
    expect(await readScenario.supportsPreview({path: supported})).toBeTrue()
    await expect(readSpec({path: root})).rejects.toThrow("одновременно scenario.spec.ts и scenario.spec.tsx")
    expect(await prepareStorybookScenarios(descriptor, new AbortController().signal,
      undefined, {standard: "transition", warnings})).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain("однозначного")
    await expect(prepareStorybookScenarios(descriptor, new AbortController().signal)).rejects.toThrow("однозначного")
  } finally { rmSync(root, {recursive: true, force: true}) }

}, 30000)


test("сборка отклоняет раздельные Component и props вместо незаметного пропуска сценария", async () => {
  const path = resolve(import.meta.dir, "../../../../specs/scenarios/reader/spec/fixture/component/spec/separate-props.test.tsx")
  const descriptor = {scenarioSpecs: [{nodeId: "invalid", sourcePaths: [path]}]} as unknown as StorybookPackageBuildDescriptor
  await expect(prepareStorybookScenarios(descriptor, new AbortController().signal)).rejects.toThrow("render принимает ровно один аргумент")
}, 30_000)
