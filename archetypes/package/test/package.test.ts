import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, rm, symlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import {readPackage} from "@archetypes/package"
import {readPackageIndex} from "@archetypes/package/index"
import {readPackageReadme} from "@archetypes/package/readme"
import {readScenario} from "@archetypes/specs/scenarios"

const root = await mkdtemp(resolve(tmpdir(), "archetype-package-"))
afterAll(() => rm(root, {recursive: true, force: true}))

/** Создаёт локальный файловый пример; исходники намеренно не пригодны для исполнения. */
async function fixture(name: string, extension = "ts") {
  const path = resolve(root, name)
  await mkdir(resolve(path, "contract"), {recursive: true})
  await writeFile(resolve(path, "package.json"), JSON.stringify({
    name: `@fixture/${name}`, label: name, description: "Файловый пример пакета",
    exports: {".": `./index.${extension}`},
  }))
  await writeFile(resolve(path, `index.${extension}`), 'throw new Error("Код проверяемого пакета не должен исполняться")')
  await writeFile(resolve(path, "contract/input.ts"), "export interface Input {}")
  await writeFile(resolve(path, "contract/output.ts"), "export interface Output {}")
  await writeFile(resolve(path, "README.md"), `# ${name}\n\nНазначение пакета.\n`)
  return path
}

describe("Чтение состава пакета", () => {
  test.each(["ts", "tsx"])("Вход %s читается без исполнения", async extension => {
    const path = await fixture(`component-${extension}`, extension)
    const result = await readPackage({path})
    expect(result.packageJson.name).toBe(`@fixture/component-${extension}`)
    expect(result.readme.content).toContain("Назначение пакета")
    expect(result.index.entries).toEqual([{
      path: ".", target: `./index.${extension}`, conditions: [], status: "owned", code: true, entrypoint: true,
      input: "./contract/input.ts", output: "./contract/output.ts",
    }])
  })

  test("Отсутствующий и пустой README различаются", async () => {
    const path = await fixture("overview")
    await writeFile(resolve(path, "README.md"), "")
    expect(await readPackageReadme({path})).toEqual({content: ""})
    await rm(resolve(path, "README.md"))
    expect(await readPackageReadme({path})).toEqual({content: null})
    await symlink(resolve(root, "component-ts/README.md"), resolve(path, "README.md"))
    expect(await readPackageReadme({path})).toEqual({content: null})
  })

  test("Граница владельца и отсутствующие файлы видимы отдельно", async () => {
    const path = await fixture("ownership")
    await mkdir(resolve(path, "nested"))
    await writeFile(resolve(path, "nested/package.json"), '{"name":"@fixture/nested"}')
    await writeFile(resolve(path, "nested/index.ts"), "")
    await symlink(resolve(path, "index.ts"), resolve(path, "alias.ts"))
    const result = await readPackageIndex({path, exports: {
      "./missing": "./missing/index.ts", "./nested": "./nested/index.ts",
      "./outside": "../outside.ts", "./alias": "./alias.ts", "./closed": null,
    }})
    expect(result.entries.map(entry => [entry.path, entry.status])).toEqual([
      ["./missing", "missing"], ["./nested", "nested-package"], ["./outside", "outside-package"],
      ["./alias", "symlink"], ["./closed", "blocked"],
    ])
    expect(result.entries.every(entry => entry.input === null && entry.output === null)).toBeTrue()
  })

  test("Условные ветви сохраняют путь и не выбирают среду", async () => {
    const path = await fixture("conditions")
    const result = await readPackageIndex({path, exports: {
      ".": {browser: {import: "./index.ts"}, default: "./index.ts"},
      "./*": "./src/*.ts", "./fallback": ["./missing.ts", "./index.ts"], "./unknown": 42,
    }})
    expect(result.entries.map(entry => [entry.path, entry.conditions, entry.status])).toEqual([
      [".", ["browser", "import"], "owned"], [".", ["default"], "owned"],
    ])
    expect(result.unchecked.map(entry => entry.path)).toEqual(["./*", "./fallback", "./unknown"])
    expect((await readPackageIndex({path, exports: {default: "./index.ts"}})).entries[0])
      .toMatchObject({path: ".", conditions: ["default"], status: "owned"})
  })

  test("Ресурс не становится кодовым входом и не получает контракты соседа", async () => {
    const path = await fixture("resources")
    await writeFile(resolve(path, "theme.css"), ":root {}")
    const result = await readPackageIndex({path, exports: {"./theme.css": "./theme.css"}})
    expect(result.entries[0]).toMatchObject({status: "owned", code: false, entrypoint: false, input: null, output: null})
    await rm(resolve(path, "contract/output.ts"))
    expect((await readPackage({path})).index.entries[0]).toMatchObject({input: "./contract/input.ts", output: null})
  })

  test("Сценарий применяется к внешнему пакету и объясняет нарушение", async () => {
    const path = await fixture("invalid")
    await rm(resolve(path, "index.ts"))
    const result = await readScenario({path: resolve(import.meta.dir, "../spec/scenario.spec.ts"), props: {path}})
    expect(result.exitCode).not.toBe(0)
    expect(result.calls.find(call => call.name === "readPackage")?.args).toEqual([{path}])
    expect(result.stdout + result.stderr).toContain("Принадлежность файлов")
    expect(result.stdout + result.stderr).toContain("missing")
    expect(result.preview?.kind).toBe("function")
  }, 30_000)

  test("Нераскрытый шаблон остаётся незавершённой проверкой, а не нарушением", async () => {
    const path = await fixture("pattern")
    await writeFile(resolve(path, "package.json"), JSON.stringify({
      name: "@fixture/pattern", label: "Шаблон", description: "Пакет с шаблонным экспортом",
      exports: {"./*": "./src/*.ts"},
    }))
    const result = await readScenario({path: resolve(import.meta.dir, "../spec/scenario.spec.ts"), props: {path}})
    expect(result.exitCode).toBe(0)
    expect(result.tests.find(point => point.label === "Полнота раскрытия exports")?.status).toBe("todo")
  }, 30_000)
})
