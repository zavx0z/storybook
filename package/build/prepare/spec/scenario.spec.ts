import {afterAll, describe, expect, setDefaultTimeout, test} from "bun:test"
import {existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import discover from "@repo/discovery"
import createGraph from "@package-graph/create"
import revision from "@package/revision"
import createBuilder from "@package-build/prepare"
import type {PackageSession} from "@package/session"

const toolRoot = realpathSync(resolve(import.meta.dir, "../../../.."))
setDefaultTimeout(60_000)

describe.each([
  {name: "Первая независимая ревизия", props: {revision: "revision-a"}},
])("$name", async ({props}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-build-scenario-")))
  afterAll(() => rmSync(root, {recursive: true, force: true}))
  const packageRoot = join(root, "package")
  const sourcePath = join(packageRoot, "package.json")
  const browserEntryPath = join(root, "browser-entry.ts")
  const stagingDirectory = join(root, ".candidate")
  mkdirSync(join(packageRoot, "module"), {recursive: true})
  mkdirSync(join(root, "node_modules/@zavx0z"), {recursive: true})
  symlinkSync(realpathSync(join(toolRoot, "node_modules/@zavx0z/jsx")), join(root, "node_modules/@zavx0z/jsx"))
  symlinkSync(realpathSync(join(toolRoot, "node_modules/@zavx0z/template")), join(root, "node_modules/@zavx0z/template"))
  writeFileSync(join(root, "package.json"), JSON.stringify({name: "@fixture/repo", type: "module"}))
  writeFileSync(sourcePath, JSON.stringify({name: "@fixture/package", type: "module"}))
  writeFileSync(join(packageRoot, "module/index.ts"), "export const module = true\n")
  writeFileSync(browserEntryPath, "export default async function startExternalStorybookPackage(input: unknown) { return input }\n")

  const graph = createGraph(await discover([packageRoot]))
  const declarationDigest = "fixture-declaration"
  const descriptor = {
    packageId: "@fixture/package",
    packageRoot,
    repo: root,
    sourcePath,
    declarationDigest,
    graphSnapshot: revision.create(graph, "@fixture/package", declarationDigest),
    resourceFiles: [],
    scenarioSpecs: [],
  } as PackageSession.Input[0]
  const build = createBuilder({toolRoot, browserEntryPath})
  const result = await build({
    descriptor,
    generation: 1,
    candidateRevision: props.revision,
    revisionUrl: `/__storybook/revisions/%40fixture%2Fpackage/${props.revision}/`,
    stagingDirectory,
    signal: new AbortController().signal,
  })

  test("Browser entry", () => {
    expect(existsSync(join(stagingDirectory, result.entryRelativePath)), "Worker создал входной JS-артефакт выбранной ревизии")
      .toBeTrue()
  })

  test("Готовый модульный граф", () => {
    expect(result.moduleGraphRevision, "Готовые модули имеют идентификатор своего содержимого")
      .toMatch(/^[a-f0-9]{64}$/u)
  })

  test("Payload ревизии", () => {
    expect(readFileSync(join(stagingDirectory, "revision-payload.js"), "utf8"), "Артефакт связывает ревизию с подготовленной таблицей сценариев")
      .toContain("STORYBOOK_PACKAGE_SCENARIO_LOADERS")
  })
})
