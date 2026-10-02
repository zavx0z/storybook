import {afterAll, describe, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import plan from "@package-build/plan"
import createVerifier from "@package-build/fingerprint"
import revision from "@package/revision"
import type {PackageSession} from "@package/session"

const toolRoot = realpathSync(resolve(import.meta.dir, "../../../.."))

describe.each([
  {name: "Подтверждённые входы", props: {stale: false}},
  {name: "Устаревший источник", props: {stale: true}},
])("$name", ({props}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-fingerprint-scenario-")))
  afterAll(() => rmSync(root, {recursive: true, force: true}))
  const sourcePath = join(root, "package.json")
  const modulePath = join(root, "module/spec/scenario.spec.ts")
  const browserEntryPath = join(root, "browser-entry.ts")
  mkdirSync(join(root, "module/spec"), {recursive: true})
  writeFileSync(sourcePath, JSON.stringify({name: "@fixture/fingerprint"}))
  writeFileSync(modulePath, "export const scenario = true\n")
  writeFileSync(browserEntryPath, "export {}\n")

  const descriptor = {
    packageId: "@fixture/fingerprint",
    packageRoot: root,
    repo: root,
    sourcePath,
    declarationDigest: "fixture-declaration",
    graphSnapshot: {protocol: revision.protocol, packageId: "@fixture/fingerprint", declarationDigest: "fixture-declaration", packageGraphDigest: "fixture-graph"},
    resourceFiles: [],
    scenarioSpecs: [{nodeId: "package:@fixture/fingerprint", sourcePaths: [modulePath]}],
  } as unknown as PackageSession.Input[0]
  const evidence = plan.compute({toolRoot, descriptor, browserEntryPath})
  const verify = createVerifier({toolRoot, browserEntryPath})
  if (props.stale) writeFileSync(modulePath, "export const scenario = false\n")
  const result = verify(evidence, descriptor)

  test("Повторная проверка сохранённого свидетельства", () => {
    expect(result?.digest ?? null, "Cache hit допустим только для тех же исходных байтов и того же плана сборки")
      .toBe(props.stale ? null : evidence.digest)
  })
})
