import {expect, test} from "bun:test"
import {resolve} from "node:path"
import readTypeDoc from "@archetypes/typedoc"

const path = resolve(import.meta.dir, "../spec/fixture/prepare.ts")

test("Теги generic и членов сохраняются у родительского типа", async () => {
  const result = await readTypeDoc({paths: [path, path]})
  expect(result.sources).toHaveLength(1)
  const declaration = result.sources[0]!.declarations.find(value => value.name === "Operation")!
  expect(declaration.typeParameters).toEqual(["Prepared"])
  expect(declaration.callables).toEqual(["prepare", "publish"])
  expect(declaration.tags.filter(tag => tag.name === "property").map(tag => tag.text.split(" ")[0])).toEqual(["prepare", "publish"])
  expect(result.sources[0]!.declarations.some(value => value.name === "Operation.prepare")).toBeFalse()
  expect(result.sources[0]!.digest).toMatch(/^[a-f0-9]{64}$/u)
  expect(result.sources[0]!.module).toContain("без внешних побочных эффектов")
})

test("Ошибка чтения не превращается в пустую документацию", async () => {
  await expect(readTypeDoc({paths: []})).rejects.toThrow("Укажите хотя бы один исходник")
  await expect(readTypeDoc({paths: [resolve(import.meta.dir, "missing.ts")]})).rejects.toThrow()
})
