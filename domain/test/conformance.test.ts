import {expect, test} from "bun:test"
import {mkdir, mkdtemp, realpath, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import readScenario from "@storybook-specs-scenarios/reader"

test("Domain с двумя настоящими входами без index проходит нормативный сценарий", async () => {
  const result = await readScenario({
    path: resolve(import.meta.dir, "../../package/reader/spec/scenario.spec.ts"),
    props: {path: resolve(import.meta.dir, "../spec/fixture/domain")},
  })
  expect(result.exitCode, result.stderr).toBe(0)
  expect(result.tests.filter(point => point.status !== "passed" && !(point.status === "skipped" && point.skipReason))).toEqual([])
}, 30_000)

test("штатный резолвер выбирает публичный вход браузера и сервера", async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "domain-resolution-")))
  try {
    await mkdir(resolve(root, "node_modules/@fixture"), {recursive: true})
    await symlink(resolve(import.meta.dir, "../spec/fixture/domain"), resolve(root, "node_modules/@fixture/archetype-domain"))
    await Bun.write(resolve(root, "entry.ts"), 'import subject from "@fixture/archetype-domain"\nconsole.log(subject)\n')
    for (const target of ["browser", "bun"] as const) {
      const build = await Bun.build({entrypoints: [resolve(root, "entry.ts")], target, minify: false})
      expect(build.success, JSON.stringify(build.logs)).toBeTrue()
      const source = await build.outputs[0]!.text()
      expect(source).toContain(target === "browser" ? "showCounter" : "advanceCounter")
      expect(source).not.toContain(target === "browser" ? "advanceCounter" : "showCounter")
    }
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})
