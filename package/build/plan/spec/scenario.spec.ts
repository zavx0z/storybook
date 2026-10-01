import {afterAll, describe, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import plan from "@package-build/plan"
import revision from "@package/revision"
import type {PackageSession} from "@package/session"

const toolRoot = realpathSync(resolve(import.meta.dir, "../../../.."))

describe.each([
  {name: "Исходник и browser entry", props: {extra: false}},
  {name: "С дополнительным входом компилятора", props: {extra: true}},
])("$name", ({props}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-plan-scenario-")))
  afterAll(() => rmSync(root, {recursive: true, force: true}))
  const sourcePath = join(root, "package.json")
  const modulePath = join(root, "module/spec/scenario.spec.ts")
  const browserEntryPath = join(root, "browser-entry.ts")
  const extraPath = join(root, "additional.ts")
  mkdirSync(join(root, "module/spec"), {recursive: true})
  writeFileSync(sourcePath, JSON.stringify({name: "@fixture/plan"}))
  writeFileSync(modulePath, "export const scenario = true\n")
  writeFileSync(browserEntryPath, "export {}\n")
  writeFileSync(extraPath, "export const additional = true\n")

  const descriptor = {
    packageId: "@fixture/plan",
    packageRoot: root,
    projectRoot: root,
    sourcePath,
    declarationDigest: "fixture-declaration",
    graphSnapshot: {protocol: revision.protocol, packageId: "@fixture/plan", declarationDigest: "fixture-declaration", packageGraphDigest: "fixture-graph"},
    resourceFiles: [],
    scenarioSpecs: [{nodeId: "package:@fixture/plan", sourcePaths: [modulePath]}],
  } as unknown as PackageSession.Input[0]
  const result = plan.resolve({toolRoot, descriptor, browserEntryPath,
    ...(props.extra ? {additionalFilePaths: [extraPath]} : {})})

  test("Точные входы", () => {
    expect(result.scope.files, "План включает manifest, сценарий и browser entry выбранной ревизии")
      .toEqual(expect.arrayContaining([sourcePath, modulePath, browserEntryPath]))
  })

  test("Дополнительная зависимость", () => {
    expect(result.scope.files.includes(extraPath), "Фактическая compiler closure расширяет план только при явной передаче")
      .toBe(props.extra)
  })
})
