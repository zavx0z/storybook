/**
Сценарии чтения спецификации непосредственного владельца.

`describe.each` задаёт владельца и ожидаемый путь в файловой фикстуре.
{@link readSpec} выполняет сценарий из непосредственной директории `spec`
выбранного владельца, без обхода вложенных владельцев. Фикстуры проверяют имена своих
директорий; проверки результата чтения сопоставляют группу, пункт и данные expect
с выбранным примером.

`SPEC_PATH` задаёт путь владельца вместо пути фикстуры. При внешней проверке
применимый вариант выбирается фильтром имени теста `--test-name-pattern`.
Без переменной каждый вариант использует собственную файловую фикстуру.

Каждый тест передаёт сообщение с названием варианта непосредственно в `expect`.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {basename, dirname, resolve} from "node:path"
import {readSpec} from "@archetypes/specs"
import {createFixture} from "../../shared/fixtures"

const resolvePath = createFixture(process.env.SPEC_PATH)

/** Четыре варианта размещения спецификации у непосредственного владельца. */
describe.each([
  {
    name: "Репозиторий",
    props: {path: resolvePath("fixture/repository")},
  },
  {
    name: "Пакет",
    props: {path: resolvePath("fixture/repository/package")},
  },
  {
    name: "Категория",
    props: {path: resolvePath("fixture/repository/package/category")},
  },
  {
    name: "Сущность",
    props: {path: resolvePath("fixture/repository/package/category/entity")},
  },
])("$name", async ({name, props}) => {
  const result = await readSpec(props)

  test("Находит только непосредственную директорию spec", () => {
    expect(
      result?.scenario ? dirname(result.scenario.path) : null,
      `Ожидается, что ${name.toLowerCase()} содержит найденную директорию spec непосредственно на своём уровне`,
    ).toBe(resolve(props.path, "spec"))
  })

  test("Возвращает данные выполненного сценария", () => {
    expect(
      result?.scenario,
      `Спецификация, которой владеет ${name.toLowerCase()}, должна возвращать данные выполненного сценария`,
    ).toEqual(expect.objectContaining({
      path: resolve(props.path, "spec", "scenario.spec.ts"),
      exitCode: expect.any(Number),
      calls: expect.any(Array),
    }))
  })

  /** @remarks Состав примера относится к локальной фикстуре; внешний SPEC_PATH содержит собственные пункты и данные. */
  test.skipIf(process.env.SPEC_PATH !== undefined)("Данные примера", () => {
    expect(
      result?.scenario && {
        exitCode: result.scenario.exitCode,
        groups: result.scenario.groups.map(group => group.label),
        tests: result.scenario.tests.map(item => ({label: item.label, status: item.status})),
        assertions: result.scenario.assertions.map(assertion => ({
          actual: assertion.actual,
          matcher: assertion.matcher,
          expected: assertion.expected,
          status: assertion.status,
        })),
      },
      `Выполненный сценарий ${name.toLowerCase()} с пунктом проверки имени собственной директории и его фактическими данными`,
    ).toEqual({
      exitCode: 0,
      groups: [name],
      tests: [{label: "Имя директории", status: "passed"}],
      assertions: [{
        actual: basename(props.path),
        matcher: "toBe",
        expected: [basename(props.path)],
        status: "passed",
      }],
    })
  })
})
