/**
Сценарии размещения служебной директории спецификации.

`describe.each` задаёт владельца и ожидаемый путь в файловой фикстуре.
Сценарии вызывают [findSpec](../src/find-spec.ts): у репозитория, пакета, категории и сущности
находится только непосредственно принадлежащая им директория `spec`.
Вложенные владельцы не обходятся; состав найденной спецификации здесь не проверяется.
Тест напрямую запускает поиск по пути из `props` выбранного сценария
и сравнивает фактический результат с ожидаемым;
этот же результат предназначен для отображения человеку и представления через MCP.

Одни и те же правила предназначены для проверки проектов, визуализации человеку
и представления агенту через MCP. Контракт извлечения параметров ещё разрабатывается.

`SPEC_PATH` задаёт путь владельца вместо пути фикстуры. При внешней проверке
применимый вариант выбирается фильтром имени теста `--test-name-pattern`.
Без переменной каждый вариант использует собственную файловую фикстуру.

Каждый тест передаёт сообщение с названием варианта непосредственно в `expect`.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {dirname, resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {readSpec} from "@archetypes/specs"

const fixture = fileURLToPath(new URL("./fixture/", import.meta.url))
const inputPath = process.env.SPEC_PATH

/** Четыре варианта размещения спецификации у непосредственного владельца. */
describe.each([
  {
    name: "Репозиторий",
    props: {path: inputPath ?? resolve(fixture, "repository")},
    expected: resolve(inputPath ?? resolve(fixture, "repository"), "spec"),
  },
  {
    name: "Пакет",
    props: {path: inputPath ?? resolve(fixture, "repository/package")},
    expected: resolve(inputPath ?? resolve(fixture, "repository/package"), "spec"),
  },
  {
    name: "Категория",
    props: {path: inputPath ?? resolve(fixture, "repository/package/category")},
    expected: resolve(inputPath ?? resolve(fixture, "repository/package/category"), "spec"),
  },
  {
    name: "Сущность",
    props: {path: inputPath ?? resolve(fixture, "repository/package/category/entity")},
    expected: resolve(inputPath ?? resolve(fixture, "repository/package/category/entity"), "spec"),
  },
])("$name", async ({name, props, expected}) => {
  const result = await readSpec(props)

  test("Находит только непосредственную директорию spec", () => {
    expect(
      result?.scenario ? dirname(result.scenario.path) : null,
      `Ожидается, что ${name.toLowerCase()} содержит найденную директорию spec непосредственно на своём уровне`,
    ).toBe(expected)
  })

  test("Возвращает данные выполненного сценария", () => {
    expect(
      result?.scenario,
      `Спецификация, которой владеет ${name.toLowerCase()}, должна возвращать данные выполненного сценария`,
    ).toEqual(expect.objectContaining({
      path: resolve(expected, "scenario.spec.ts"),
      exitCode: expect.any(Number),
      calls: expect.any(Array),
    }))
  })
})
