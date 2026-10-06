import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {readPreloads} from "../src/preloads"
import {traceScenario} from "../src/trace"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true})
})

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "scenario-preloads-")))
  roots.push(root)
  await mkdir(join(root, ".git"))
  const owner = join(root, "packages/component")
  await mkdir(join(owner, "spec"), {recursive: true})
  await writeFile(join(root, "package.json"), JSON.stringify({name: "fixture-root", workspaces: ["packages/*"]}))
  await writeFile(join(owner, "package.json"), JSON.stringify({name: "fixture-component", type: "module"}))
  await writeFile(join(root, "setup.ts"), "export {}\n")
  await writeFile(join(root, "bunfig.toml"), '[test]\npreload = ["./setup.ts"]\n')
  return {root, owner, path: join(owner, "spec/scenario.spec.ts")}
}

test("вложенный пакет наследует preload репозитория с путём относительно bunfig", async () => {
  const f = await fixture()
  expect(await readPreloads(f.owner, f.path)).toEqual([join(f.root, "setup.ts")])
})

test("локальный preload заменяет унаследованный, а пустой список явно отключает наследование", async () => {
  const f = await fixture()
  await writeFile(join(f.owner, "local.ts"), "export {}\n")
  await writeFile(join(f.owner, "bunfig.toml"), '[test]\npreload = ["./local.ts"]\n')
  expect(await readPreloads(f.owner, f.path)).toEqual([join(f.owner, "local.ts")])
  await writeFile(join(f.owner, "bunfig.toml"), '[test]\npreload = []\n')
  expect(await readPreloads(f.owner, f.path)).toEqual([])
})

test("scripts.test с явным preload сохраняет собственную среду пакета", async () => {
  const f = await fixture()
  await writeFile(join(f.owner, "local.ts"), "export {}\n")
  await writeFile(join(f.owner, "package.json"), JSON.stringify({name: "fixture-component", scripts: {test: "bun test --preload ./local.ts ./spec"}}))
  expect(await readPreloads(f.owner, f.path)).toEqual([join(f.owner, "local.ts")])
})

test("посторонние настройки локального bunfig не скрывают общий test.preload", async () => {
  const f = await fixture()
  await writeFile(join(f.owner, "bunfig.toml"), '[install]\npeer = false\n')
  expect(await readPreloads(f.owner, f.path)).toEqual([join(f.root, "setup.ts")])
})

test("поиск не выходит за Git-корень и границу node_modules", async () => {
  const f = await fixture()
  await writeFile(join(f.root, "bunfig.toml"), '[install]\npeer = false\n')
  expect(await readPreloads(f.owner, f.path)).toEqual([])
  await writeFile(join(f.root, "bunfig.toml"), '[test]\npreload = ["./setup.ts"]\n')
  await mkdir(join(f.owner, ".git"))
  expect(await readPreloads(f.owner, f.path)).toEqual([])
  const installed = join(f.root, "node_modules/dependency")
  await mkdir(installed, {recursive: true})
  await writeFile(join(installed, "package.json"), '{"name":"dependency"}')
  expect(await readPreloads(installed, join(installed, "spec.ts"))).toEqual([])
})

test("унаследованный plugin исполняется до статического TSX-импорта сценария", async () => {
  const f = await fixture()
  await writeFile(join(f.root, "tsconfig.json"), JSON.stringify({compilerOptions: {target: "ESNext", module: "ESNext", types: []}, include: ["packages/**/*.ts", "packages/**/*.tsx"]}))
  await writeFile(join(f.root, "setup.ts"), `import {plugin} from "bun"
plugin({name: "fixture-tsx", setup(build) {
  build.onLoad({filter: /component\\.tsx$/}, () => ({contents: 'export const value = "compiled-by-root"', loader: "ts"}))
}})
`)
  await writeFile(join(f.owner, "component.tsx"), 'export const value = <div />\n')
  await writeFile(f.path, `import {test, expect} from "bun:test"
import {value} from "../component.tsx"
test("подготовленный компонент", () => { expect(value).toBe("compiled-by-root") })
`)
  const result = await traceScenario({path: f.path})
  expect(result.exitCode).toBe(0)
  expect(result.tests.map(test => test.status)).toEqual(["passed"])
  expect(result.stderr).not.toContain("react/jsx-dev-runtime")
}, 15000)
