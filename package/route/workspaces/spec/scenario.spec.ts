/** Публичное обнаружение состава workspace по штатным glob с сохранением наблюдаемых входов. */
import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import readWorkspacePackages from "@route/workspaces"

describe.each([
  {name: "Пустой состав", props: {value: []}, expected: []},
  {name: "Рекурсия и исключение", props: {value: ["plain", "packages/*", "packages/**", "!packages/excluded/**"]}, expected: ["plain", "packages/a", "packages/z", "packages/group/nested"]},
  {name: "Выбор через альтернативы glob", props: {value: ["packages/{a,z}"]}, expected: ["packages/a", "packages/z"]},
])("$name", async ({props, expected}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "workspaces-scenario-")))
  afterAll(() => rm(root, {recursive: true, force: true}))
  for (const path of ["plain", "packages/z", "packages/a", "packages/group/nested", "packages/excluded", "packages/node_modules/dependency"]) {
    await mkdir(join(root, path), {recursive: true})
    await Bun.write(join(root, path, "package.json"), JSON.stringify({name: path.replaceAll("/", "-")}))
  }
  const result = await readWorkspacePackages({root, value: props.value})
  test("Публичный состав", () => {
    expect(result.roots, "Glob раскрывает точный упорядоченный состав без дубликатов, исключённых пакетов и node_modules")
      .toEqual(expected.map(path => join(root, path)))
  })
  test("Наблюдаемые входы", () => {
    expect(result.inputs, "Читатель возвращает явные источники инвалидирования, не создавая отдельный реестр").toBeArray()
  })
})
