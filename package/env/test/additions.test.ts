import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, readFile, rm, cp, symlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import environment from "@zavx0z/storybook-package-env"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true}) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "env-declaration-"))
  roots.push(root)
  await cp(resolve(import.meta.dir, "../spec/fixture/extended"), root, {recursive: true})
  return root
}

test("декларация содержит ссылки, не загружает модули и не читает документы", async () => {
  const directory = await fixture()
  await writeFile(join(directory, ".agent/tools/example.summary/index.ts"), 'throw new Error("Обнаружение не исполняет код")')
  await writeFile(join(directory, ".agent/tools/example.summary/description.json"), "Не JSON, только ссылка")
  const declared = environment({directory})
  expect(Object.keys(declared.tools)).toHaveLength(11)
  expect(declared.tools["example.summary"]!.implementation).toEqual({package: "./.agent/tools/example.summary", export: "."})
  expect(JSON.stringify(declared)).not.toContain("Обнаружение не исполняет код")
  expect(JSON.stringify(declared)).not.toContain("Изменения относятся")
  expect(declared.rules.development).toEqual({path: ".agent/rules/development.md"})
})

test("инструменты пакета не наследуются детьми и не поступают из детей", async () => {
  const directory = await fixture()
  const child = join(directory, "child")
  await mkdir(child)
  expect(Object.keys(environment({directory: child}).tools)).toHaveLength(10)
  expect(environment({directory: child}).rules).not.toHaveProperty("development")
  await cp(join(directory, ".agent"), join(child, ".agent"), {recursive: true})
  await rm(join(directory, ".agent"), {recursive: true})
  expect(Object.keys(environment({directory}).tools)).toHaveLength(10)
  expect(Object.keys(environment({directory: child}).tools)).toHaveLength(11)
})

test("локальная реализация не заменяет обязательный инструмент", async () => {
  const directory = await fixture()
  await cp(join(directory, ".agent/tools/example.summary"), join(directory, ".agent/tools/filesystem.read"), {recursive: true})
  expect(() => environment({directory})).toThrow("Повтор имени инструмента: filesystem.read")
})

test("вспомогательные файлы не становятся инструментами; неполный инструмент — ошибка", async () => {
  const directory = await fixture()
  await writeFile(join(directory, ".agent/tools/helper.ts"), "throw 1")
  expect(Object.keys(environment({directory}).tools)).toHaveLength(11)
  await rm(join(directory, ".agent/tools/example.summary/contract/index.ts"))
  expect(() => environment({directory})).toThrow("Отсутствует обычный исходник")
})

test("ссылки на чужие каталоги не включаются в собственные дополнения", async () => {
  const directory = await fixture()
  const child = join(directory, "child")
  await mkdir(child)
  await symlink(join(directory, ".agent"), join(child, ".agent"))
  expect(() => environment({directory: child})).toThrow("Каталог окружения должен принадлежать пакету")
})
