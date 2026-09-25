import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, rm, symlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import {readPackage} from "@archetypes/package"
import {readModuleDocumentation} from "@archetypes/package/documentation"
import {readPackageIndex} from "@archetypes/package/index"
import {readPackageJson} from "@archetypes/package/package-json"
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
  await writeFile(resolve(path, `index.${extension}`), '/**\nОписание модуля.\n@packageDocumentation\n*/\nthrow new Error("Код проверяемого пакета не должен исполняться")')
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
    expect(result.documentation?.markdown).toBe("Описание модуля.")
    expect(result.documentation?.sourcePath).toBe(resolve(path, `index.${extension}`))
    expect(result.index.entries).toEqual([{
      path: ".", target: `./index.${extension}`, conditions: [], status: "owned", code: true, entrypoint: true,
      input: "./contract/input.ts", output: "./contract/output.ts",
    }])
  })

  test("README не влияет на чтение пакета, отсутствие TSDoc явно видно", async () => {
    const path = await fixture("overview")
    const initial = await readPackage({path})
    await writeFile(resolve(path, "README.md"), "Совсем другой текст")
    expect(await readPackage({path})).toEqual(initial)
    await writeFile(resolve(path, "index.ts"), "export const value = 1")
    expect((await readPackage({path})).documentation).toBeNull()
  })

  test("Корневой index.tsx имеет приоритет, а его TSDoc меняет результат", async () => {
    const path = await fixture("documentation")
    await writeFile(resolve(path, "index.tsx"), "/**\nПриоритетный обзор.\n@packageDocumentation\n*/\nexport const value = 1")
    const first = await readPackage({path})
    expect(first.documentation?.markdown).toBe("Приоритетный обзор.")
    await writeFile(resolve(path, "index.tsx"), "/**\nИзменённый обзор.\n@packageDocumentation\n*/\nexport const value = 1")
    const next = await readPackage({path})
    expect(next.documentation?.markdown).toBe("Изменённый обзор.")
    expect(next.documentation?.sourceDigest).not.toBe(first.documentation?.sourceDigest)
  })

  test("Существующий index.tsx без TSDoc не подменяется описанием index.ts", async () => {
    const path = await fixture("tsx-without-documentation")
    await writeFile(resolve(path, "index.tsx"), "export const value = 1")
    expect((await readPackage({path})).documentation).toBeNull()
  })

  test("Symlink на исходник не читается за пределами пакета", async () => {
    const path = await fixture("linked-documentation")
    await rm(resolve(path, "index.ts"))
    await writeFile(resolve(root, "outside.ts"), "/**\nЧужое описание.\n@packageDocumentation\n*/")
    await symlink(resolve(root, "outside.ts"), resolve(path, "index.ts"))
    expect((await readPackage({path})).documentation).toBeNull()
  })

  test("Исходник ограничен одним МиБ", async () => {
    const path = await fixture("large-documentation")
    await writeFile(resolve(path, "index.ts"), `/**\nОписание.\n@packageDocumentation\n*/\n${"x".repeat(1024 * 1024)}`)
    await expect(readPackage({path})).rejects.toThrow(RangeError)
    expect(() => readModuleDocumentation({source: "x".repeat(1024 * 1024 + 1), path: "index.ts"})).toThrow(RangeError)
  })

  test("label можно опустить, но нельзя задать значением другого типа", async () => {
    const path = await fixture("optional-label")
    const manifestPath = resolve(path, "package.json")
    const manifest = {name: "@fixture/optional-label", description: "Пакет без подписи", exports: {".": "./index.ts"}}
    await writeFile(manifestPath, JSON.stringify(manifest))
    expect(await readPackageJson({path: manifestPath})).toEqual(manifest)
    expect((await readPackage({path})).packageJson).toEqual(manifest)
    const scenario = await readScenario({path: resolve(import.meta.dir, "../spec/scenario.spec.ts"), props: {path}})
    expect(scenario.exitCode).toBe(0)
    await writeFile(manifestPath, JSON.stringify({...manifest, label: 42}))
    await expect(readPackageJson({path: manifestPath})).rejects.toThrow(TypeError)
  }, 30_000)

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
