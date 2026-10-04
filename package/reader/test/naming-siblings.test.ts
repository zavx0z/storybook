/** Package передаёт в Name соседей реального уровня, включая обычные директории. */
import {expect, test} from "bun:test"
import {mkdir, mkdtemp, realpath, rm, symlink} from "node:fs/promises"
import {resolve} from "node:path"
import readScenario from "@zavx0z/storybook-specs-scenarios-reader"

const scenario = resolve(import.meta.dir, "../spec/scenario.spec.ts")

test.each([
  {name: "Соседний пакет", sibling: "package", directory: "failed", npm: "failed"},
  {name: "Соседняя обычная директория", sibling: "directory", directory: "failed", npm: "passed"},
  {name: "Игнорируемый сосед", sibling: "ignored", directory: "passed", npm: "passed"},
  {name: "Символическая ссылка", sibling: "symlink", directory: "passed", npm: "passed"},
])("$name", async ({sibling, directory, npm}) => {
  const parent = resolve(import.meta.dir, "fixture")
  await mkdir(parent, {recursive: true})
  const root = await realpath(await mkdtemp(resolve(parent, ".naming-siblings-")))
  try {
    const own = resolve(root, "mcp-source")
    await Bun.write(resolve(own, "package.json"), JSON.stringify({name: "@fixture/mcp-source", type: "module", exports: {".": "./index.ts"}}))
    await Bun.write(resolve(own, "index.ts"), "export default 1\n")
    if (sibling === "symlink") {
      await mkdir(resolve(root, "target"))
      await symlink(resolve(root, "target"), resolve(root, "mcp"))
    } else {
      await mkdir(resolve(root, "mcp"))
      if (sibling !== "directory") {
        await Bun.write(resolve(root, "mcp/package.json"), JSON.stringify({name: "@fixture/mcp"}))
      }
      if (sibling === "ignored") await Bun.write(resolve(root, ".gitignore"), "mcp/\n")
    }
    const report = await readScenario({path: scenario, props: {path: own}, testNamePattern: "Имя директории|Имя пакета"})
    expect(report.tests.find(point => point.label === "Имя директории")?.status).toBe(directory)
    expect(report.tests.find(point => point.label === "Имя пакета")?.status).toBe(npm)
    expect(report.exitCode === 0).toBe(directory === "passed" && npm === "passed")
  } finally {
    await rm(root, {recursive: true, force: true})
  }
}, 30_000)
