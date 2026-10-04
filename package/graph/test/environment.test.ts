import {expect, test} from "bun:test"
import {mkdir, mkdtemp, realpath, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import readScenario from "@storybook-specs-scenarios/reader"

test("Graph проходит единый нормативный сценарий Domain", async () => {
  const report = await readScenario({path: resolve(import.meta.dir, "../../reader/spec/scenario.spec.ts"), props: {path: resolve(import.meta.dir, "..")}})
  expect(report.exitCode, report.stderr).toBe(0)
  expect(report.tests.filter(point => point.status !== "passed" && !(point.status === "skipped" && point.skipReason))).toEqual([])
}, 30_000)

test("browser resolver не включает серверное создание графа", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "graph-browser-")))
  try {
    const entry = join(root, "entry.ts")
    await mkdir(join(root, "node_modules/@package"), {recursive: true})
    await symlink(resolve(import.meta.dir, ".."), join(root, "node_modules/@storybook-package/graph"))
    await Bun.write(entry, 'import graph from "@storybook-package/graph"\nconsole.log(graph)\n')
    const result = await Bun.build({entrypoints: [entry], target: "browser", minify: false})
    expect(result.success, JSON.stringify(result.logs)).toBeTrue()
    const code = await result.outputs[0]!.text()
    expect(code).not.toContain("node:crypto")
    expect(code).not.toContain("node:fs")
    expect(code).not.toContain("createExternalStorybookGraph")
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})
