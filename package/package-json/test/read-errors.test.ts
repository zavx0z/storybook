/**
Проверяет передачу ошибок файлового чтения и разбора JSON вызывающему коду.
Использует отсутствующий файл, директорию и файл с некорректным JSON.
Проверки состава возвращаемых данных остаются в spec.

@packageDocumentation
*/
import {afterAll, describe, expect, mock, test} from "bun:test"
import {resolve} from "node:path"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import type {ArchetypesPackageJson} from "@archetypes/package-json"

const readPackageJsonMock = mock(async (props: ArchetypesPackageJson.Input) => {
  const {default: readPackageJson} = await import("@archetypes/package-json")
  return readPackageJson(props)
})

const temporary: string[] = []
afterAll(async () => {
  for (const path of temporary) await rm(path, {recursive: true, force: true})
})

test("роли зависимостей сохраняются раздельно и требуют строковых версий", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "package-json-dependencies-"))
  temporary.push(root)
  const path = resolve(root, "package.json")
  const roles = {dependencies: {runtime: "1"}, peerDependencies: {host: "*"}, optionalDependencies: {optional: "2"}, devDependencies: {compiler: "3"}}
  await Bun.write(path, JSON.stringify({name: "fixture", ...roles}))
  expect(await readPackageJsonMock({path})).toMatchObject(roles)
  for (const role of Object.keys(roles)) {
    await Bun.write(path, JSON.stringify({name: "fixture", [role]: {dependency: false}}))
    await expect(readPackageJsonMock({path})).rejects.toThrow(TypeError)
  }
})

describe.each([
  {name: "Ошибки чтения package.json"},
])("$name", () => {

  test("Файл отсутствует", () => {
    const path = resolve(import.meta.dir, "fixture", "missing.json")
    expect(readPackageJsonMock({path}), "Отсутствующий файл должен приводить к ошибке чтения")
      .rejects.toMatchObject({code: "ENOENT"})
  })

  test("Вместо файла передана директория", () => {
    const path = resolve(import.meta.dir, "fixture")
    expect(readPackageJsonMock({path}), "Директория не должна приниматься вместо файла package.json")
      .rejects.toMatchObject({code: "EISDIR"})
  })

  test("Некорректный JSON", () => {
    const path = resolve(import.meta.dir, "fixture", "invalid.json")
    expect(readPackageJsonMock({path}), "Некорректный JSON должен приводить к ошибке разбора")
      .rejects.toMatchObject({name: "SyntaxError"})
  })
})

test("диапазоны engines сохраняются без подстановки настроек родительского Repo", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "package-json-engines-"))
  temporary.push(root)
  const path = resolve(root, "package.json")
  await Bun.write(path, JSON.stringify({name: "fixture", engines: {bun: "1.4.x", node: ">=22"}}))
  expect(await readPackageJsonMock({path})).toMatchObject({engines: {bun: "1.4.x", node: ">=22"}})
  await Bun.write(path, JSON.stringify({name: "fixture"}))
  expect(await readPackageJsonMock({path})).not.toHaveProperty("engines")
  for (const engines of [null, [], {bun: 14}]) {
    await Bun.write(path, JSON.stringify({name: "fixture", engines}))
    await expect(readPackageJsonMock({path})).rejects.toThrow(TypeError)
  }
})
