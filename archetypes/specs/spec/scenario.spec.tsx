/**
Сценарии размещения служебной директории спецификации.

`describe.each` задаёт владельца и ожидаемый путь в файловой фикстуре.
Сценарии вызывают [findSpec](../index.ts): у репозитория, пакета, категории и сущности
находится только непосредственно принадлежащая им директория `spec`.
Вложенные владельцы не обходятся; состав найденной спецификации здесь не проверяется.
Mock-функция получает `props` выбранного сценария и запускает поиск по указанному пути
и возвращает фактический результат. Тест сравнивает его с ожидаемым;
этот же результат предназначен для отображения человеку и представления через MCP.

Одни и те же правила предназначены для проверки проектов, визуализации человеку
и представления агенту через MCP. Контракт извлечения параметров ещё разрабатывается.

`SPEC_PATH` задаёт путь владельца вместо пути фикстуры. При внешней проверке
применимый вариант выбирается фильтром имени теста `--test-name-pattern`.
Без переменной каждый вариант использует собственную файловую фикстуру.

Поле `fail` в параметрах группы задаёт сообщение ошибки для `expect(actual, fail)`.

@packageDocumentation
*/
import {describe, expect, mock, test} from "bun:test"
import {resolve} from "node:path"
import {fileURLToPath} from "node:url"

const findSpecMock = mock(async (input: {path: string}) => {
  const {findSpec} = await import("@storybook/archetypes/specs")
  return findSpec(input.path)
})

const fixture = fileURLToPath(new URL("./fixture/", import.meta.url))
const inputPath = process.env.SPEC_PATH

/** Четыре варианта размещения спецификации у непосредственного владельца. */
describe.each([
  {
    name: "Spec репозитория",
    fail: "Должна быть найдена директория spec непосредственно в репозитории",
    props: {path: inputPath ?? resolve(fixture, "repository")},
    expected: resolve(inputPath ?? resolve(fixture, "repository"), "spec"),
  },
  {
    name: "Spec пакета",
    fail: "Должна быть найдена директория spec непосредственно в пакете",
    props: {path: inputPath ?? resolve(fixture, "repository/package")},
    expected: resolve(inputPath ?? resolve(fixture, "repository/package"), "spec"),
  },
  {
    name: "Spec категории",
    fail: "Должна быть найдена директория spec непосредственно в категории",
    props: {path: inputPath ?? resolve(fixture, "repository/package/category")},
    expected: resolve(inputPath ?? resolve(fixture, "repository/package/category"), "spec"),
  },
  {
    name: "Spec сущности",
    fail: "Должна быть найдена директория spec непосредственно в сущности",
    props: {path: inputPath ?? resolve(fixture, "repository/package/category/entity")},
    expected: resolve(inputPath ?? resolve(fixture, "repository/package/category/entity"), "spec"),
  },
])("$name", ({props, expected, fail}) => {
  test("Находит только непосредственную директорию spec", async () => {
    const actual = await findSpecMock(props)
    expect(actual, fail).toBe(expected)
  })
})
