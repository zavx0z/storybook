/**
Объясняет, что спецификация лежит непосредственно у своего владельца.
Функция Archetypes извлекает из технического отчёта файлы и примеры написания.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readSpecGuide} from "@archetypes/specs"

describe.each([
  {name: "Репозиторий", props: {path: resolve(import.meta.dir, "../../../app/spec-reader/spec/fixture/repository")}},
  {name: "Пакет", props: {path: resolve(import.meta.dir, "../../../app/spec-reader/spec/fixture/repository/package")}},
  {name: "Категория", props: {path: resolve(import.meta.dir, "../../../app/spec-reader/spec/fixture/repository/package/category")}},
  {name: "Сущность", props: {path: resolve(import.meta.dir, "../../../app/spec-reader/spec/fixture/repository/package/category/entity")}},
])("$name", async ({props}) => {
  const guide = await readSpecGuide(props)

  test("Непосредственная спецификация", () => {
    expect(guide?.files[0], "Сценарий находится в spec выбранного владельца").toEqual({
      path: "spec/scenario.spec.ts",
      role: "scenario",
    })
  })

  test("Авторский пример", () => {
    expect(guide?.examples.some(example => example.code.includes("describe.each")),
      "Руководство раскрывает код написания варианта, не исход выполнения функции").toBeTrue()
  })
})
