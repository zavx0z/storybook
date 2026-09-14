/**
Описывает результаты чтения серверного и компонентного сценариев.
Полная история каждого варианта сохраняется штатным snapshot-механизмом Bun.
SCENARIO_PATH задаёт внешний путь к сценарию вместо примера по умолчанию.
Относительный внешний путь разрешается от рабочей директории запуска тестов.
Вариант выбирается штатным фильтром Bun --test-name-pattern.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario, type ReadScenarioInput} from "@archetypes/specs/scenarios"
import {createFixture} from "../../../shared/fixtures"

const resolvePath = createFixture(process.env.SCENARIO_PATH)

type Scenario = {
  name: string
  props: ReadScenarioInput
  expected: {name: string, describe: string[], test: string | null, outcome: {type: string}}[]
}

describe.each([
  {
    name: "Трассировка серверной функции",
    props: {
      path: resolvePath("../../../package/spec/scenario.spec.ts"),
    },
    expected: ["Корневой пакет", "Вложенный пакет"].map(name => ({
      name: "readPackage", describe: [name], test: null, outcome: {type: "resolve"},
    })),
  },
  {
    name: "Трассировка компонента",
    props: {
      path: resolvePath("../../../../../webxr-space/nodes/node/diagram/spec/scenario.spec.tsx"),
    },
    expected: [
      ...["Прямоугольник", "Овал", "Круг"].flatMap(name => [
        {name: "createHeadless", describe: [name], test: null, outcome: {type: "return"}},
        {name: "createHeadless.render", describe: [name], test: null, outcome: {type: "resolve"}},
      ]),
      ...["Прямоугольник", "Овал", "Круг"].map(name => ({
        name: "createHeadless.screenshot", describe: [name],
        test: "снимок соответствует собственным границам", outcome: {type: "resolve"},
      })),
    ],
  },
] satisfies Scenario[])("$name", async ({props, expected}) => {
  const result = await readScenario(props)

  test("Ключи результата", () => {
    expect(result, "Состав данных о выполнении сценария").toEqual({
      path: expect.any(String),
      exitCode: expect.any(Number),
      stdout: expect.any(String),
      stderr: expect.any(String),
      calls: expect.any(Array),
    })
  })

  test("Путь сценария", () => {
    expect(result.path, "Файл сценария, которому принадлежит результат выполнения").toBe(resolve(props.path))
  })

  test("Код завершения", () => {
    expect(result.exitCode, "Итог запуска Bun Test: ноль при успешном завершении").toBe(0)
  })

  describe("Стандартный вывод", () => {
    test("Содержимое", () => {
      expect(result.stdout, "Сообщения Bun Test во время выполнения сценария").toContain("bun test")
    })

    test("Версия Bun", () => {
      expect(
        result.stdout.match(/^bun test v([^\s]+)/m)?.[1],
        "Версия среды, в которой выполнен сценарий",
      ).toMatch(/^\d+\.\d+\.\d+/)
    })
  })

  describe("Диагностический вывод", () => {
    test("Содержимое", () => {
      expect(result.stderr, "Итоги проверок и причины ошибок сценария").toMatch(/\d+ pass\s+0 fail/)
    })

    test("Успешные проверки", () => {
      expect(
        result.stderr.split("\n").filter(line => line.startsWith("(pass) ")),
        "Проверки, подтвердившие поведение сценария",
      ).not.toHaveLength(0)
    })

    test("Количество ошибок", () => {
      expect(
        Number(result.stderr.match(/^\s*(\d+) fail\s*$/m)?.[1]),
        "Число проверок с неподтверждённым ожидаемым результатом",
      ).toBe(0)
    })
  })

  describe("Вызовы", () => {
    test("Количество", () => {
      expect(result.calls.length, "Число зарегистрированных вызовов функций и методов").toBeGreaterThan(0)
    })

    test("Группы и результаты", () => {
      const calls = result.calls.filter(call => expected.some(item => item.name === call.name))

      expect(calls, "Выполненные функции и методы, их группы, тесты и исходы").toMatchObject(expected)
    })
  })

  test("Полный результат", () => {
    const snapshot = {
      ...result,
      stderr: result.stderr.replace(/ \[\d+(?:\.\d+)?(?:ms|s)\]/g, ""),
    }

    expect(snapshot, "Все данные выполнения сценария, кроме меняющихся длительностей в диагностическом выводе").toMatchSnapshot()
  })
})
