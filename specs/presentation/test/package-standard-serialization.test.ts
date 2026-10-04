import {afterAll, expect, test} from "bun:test"
import {cp, mkdir, mkdtemp, realpath, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {resolve, sep} from "node:path"
import readScenario from "@zavx0z/storybook-specs-scenarios-reader"
import readScenarios from ".."

const root = resolve(import.meta.dir, "../../..")
const scenario = resolve(root, "package/reader/spec/scenario.spec.ts")
const roots: string[] = []

afterAll(async () => {
  for (const path of roots) await rm(path, {recursive: true, force: true})
})

test.each([
  ["Domain", resolve(root, "specs")],
  ["Component", resolve(root, "component/spec/fixture/component")],
  ["Container", resolve(root, "container/spec/fixture/compose")],
] as const)("MCP документ сохраняет данные структурного сценария %s", async (role, fixturePath) => {
  let path = fixturePath
  if (role === "Container") {
    const temporaryRoot = await realpath(await mkdtemp(resolve(tmpdir(), "package-container-mcp-")))
    roots.push(temporaryRoot)
    await cp(resolve(path, ".."), temporaryRoot, {
      recursive: true,
      filter: source => !source.split(sep).includes("node_modules"),
    })
    const manifests = [...new Bun.Glob("compose/**/package.json").scanSync({cwd: temporaryRoot, absolute: true})]
    await mkdir(resolve(temporaryRoot, "node_modules/@fixture"), {recursive: true})
    for (const file of manifests) {
      const manifest = await Bun.file(file).json()
      await symlink(resolve(file, ".."), resolve(temporaryRoot, "node_modules", manifest.name))
    }
    path = resolve(temporaryRoot, "compose")
  }

  const report = await readScenario({path: scenario, props: {path}})
  expect(report.exitCode, report.stderr).toBe(0)
  const document = await readScenarios({
    path: resolve(root, "package/reader"),
    prepared: {revision: "same-execution", result: {scenario: report}},
  })
  const serialized = JSON.stringify(document)
  expect(serialized).toContain(role)
  expect(serialized).toContain("Корневой TSDoc раскрывает назначение и границы ответственности пакета")
  expect(serialized).toContain(path)
}, 30_000)
