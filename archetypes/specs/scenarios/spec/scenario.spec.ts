/**
Описывает результаты чтения серверного и компонентного сценариев.
Состав результата и вложенных записей раскрывается категориями и тестами.
SCENARIO_PATH задаёт внешний путь к сценарию вместо примера по умолчанию.
Относительный внешний путь разрешается от рабочей директории запуска тестов.
Вариант выбирается штатным фильтром Bun --test-name-pattern.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {isAbsolute, resolve} from "node:path"
import {readScenario, type ReadScenarioInput} from "@archetypes/specs/scenarios"
import {createFixture} from "../../../shared/fixtures"

const resolvePath = createFixture(process.env.SCENARIO_PATH)

/** Выбирает допустимый вид значения без фиксации содержимого чужой сущности. */
function shape(value: unknown): unknown {
  if (value === null) return null
  if (Array.isArray(value)) return expect.any(Array)
  if (typeof value === "object") return expect.any(Object)
  if (typeof value === "string") return expect.any(String)
  if (typeof value === "boolean") return expect.any(Boolean)
  if (typeof value === "number") return expect.any(Number)
  throw new Error(`Непереносимый вид данных: ${typeof value}`)
}

/**
Создаёт вложенные категории для массивов и объектов и пункты для конечных значений.

@param label - Имя поля или элемента в представлении.
@param value - Данные из результата readScenario, без повторного выполнения сценария.
@param description - Описание содержимого поля в исходном контексте.

@remarks
Имена полей произвольного объекта не являются контрактом трассировщика:
они принадлежат вызываемой функции. Проверяется переносимость каждого значения,
а не соответствие реализации компонента его собственным требованиям.
Пустые объекты и массивы сохраняют отдельный пункт состава.
*/
function describeValue(label: string, value: unknown, description: string): void {
  if (value === null || typeof value !== "object") {
    test(label, () => {
      expect(value, description).toBeOneOf([
        null,
        expect.any(String),
        expect.any(Boolean),
        expect.any(Number),
      ])
    })
    return
  }

  describe(label, () => {
    if (Array.isArray(value)) {
      test("Состав", () => {
        expect(value, description).toEqual(value.map(shape))
      })

      value.forEach((item, index) => {
        describeValue(`Элемент ${index}`, item, `Данные позиции ${index} в массиве «${label}»`)
      })
      return
    }

    const entries = Object.entries(value)

    test("Ключи", () => {
      expect(value, description).toEqual(Object.fromEntries(entries.map(([key, item]) => [key, shape(item)])))
    })

    for (const [key, item] of entries) {
      describeValue(key, item, `Данные поля «${key}» в объекте «${label}»`)
    }
  })
}

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
    test("Состав", () => {
      expect(result.calls, "Записи вызовов в порядке их начала").toEqual(
        result.calls.map(() => expect.any(Object)),
      )
    })

    test("Количество", () => {
      expect(result.calls.length, "Число зарегистрированных вызовов функций и методов").toBeGreaterThan(0)
    })

    test("Группы и результаты", () => {
      const calls = result.calls.filter(call => expected.some(item => item.name === call.name))

      expect(calls, "Выполненные функции и методы, их группы, тесты и исходы").toMatchObject(expected)
    })

    test("Порядок начала", () => {
      expect(result.calls.map(call => call.id), "Порядковые номера начала вызовов без пропусков и повторений").toEqual(
        result.calls.map((_, index) => index),
      )
    })

    test("Порядок завершения", () => {
      expect(result.calls.map(call => call.completed).sort((a, b) => a - b), "Порядковые номера завершения всех зарегистрированных вызовов").toEqual(
        result.calls.map((_, index) => index),
      )
    })

    describe.each(result.calls.map((call, index) => ({
      label: `${call.id}: ${call.name}`,
      call,
      index,
    })))("$label", ({call, index}) => {
      test("Ключи", () => {
        expect(call, "Состав записи одного вызова").toEqual({
          id: expect.any(Number),
          completed: expect.any(Number),
          module: expect.any(String),
          name: expect.any(String),
          describe: expect.any(Array),
          test: call.test === null ? null : expect.any(String),
          args: expect.any(Array),
          outcome: expect.any(Object),
          location: call.location === null ? null : expect.any(Object),
        })
      })

      test("Начало", () => {
        expect(call.id, "Позиция вызова в последовательности начала выполнения").toBe(index)
      })

      test("Завершение", () => {
        expect(call.completed, "Позиция вызова в последовательности завершения выполнения").toSatisfy(
          value => Number.isInteger(value) && value >= 0 && value < result.calls.length,
        )
      })

      test("Модуль", () => {
        expect(call.module, "Абсолютный путь к модулю вызванной функции или метода").toSatisfy(isAbsolute)
      })

      test("Имя", () => {
        expect(call.name, "Имя экспортированной функции или цепочка имени объекта и метода").not.toBeEmpty()
      })

      describe("Группы", () => {
        test("Состав", () => {
          expect(call.describe, "Иерархия групп от внешней к внутренней; пустая для вызова вне группы").toEqual(
            call.describe.map(() => expect.any(String)),
          )
        })

        describe.each(call.describe.map((label, depth) => ({label, depth})))("Уровень $depth", ({label}) => {
          test("Название", () => {
            expect(label, "Название группы, к которой принадлежит вызов").not.toBeEmpty()
          })
        })
      })

      test("Тест", () => {
        expect(call.test, "Название теста либо null при вызове вне тела теста").toBeOneOf([null, expect.any(String)])
      })

      describeValue("Аргументы", call.args, "Позиционные аргументы на момент начала вызова")

      describe("Исход", () => {
        const outcome = call.outcome
        const failed = outcome.type === "throw" || outcome.type === "reject"

        test("Ключи", () => {
          expect(outcome, "Вид завершения и полученное значение либо ошибка").toEqual(
            outcome.type === "throw" || outcome.type === "reject"
              ? {type: expect.any(String), error: outcome.error === null ? null : expect.anything()}
              : {type: expect.any(String), value: outcome.value === null ? null : expect.anything()},
          )
        })

        test("Вид завершения", () => {
          expect(outcome.type, "Синхронный возврат, завершение Promise, синхронная ошибка или отклонение Promise").toBeOneOf([
            "return", "resolve", "throw", "reject",
          ])
        })

        /**
        @remarks
        Ошибка раскрывается только для throw и reject; у успешного вызова её нет.
        */
        describe.skipIf(!failed)("Ошибка", () => {
          const error = "error" in outcome ? outcome.error : null
          describeValue("Данные", error, "Переносимые данные ошибки вызова")
        })

        /**
        @remarks
        Значение раскрывается только для return и resolve; ошибочный вызов его не возвращает.
        */
        describe.skipIf(failed)("Значение", () => {
          const value = "value" in outcome ? outcome.value : null
          describeValue("Данные", value, "Переносимые данные результата вызова")
        })
      })

      describe("Место вызова", () => {
        const location = call.location

        test("Ключи", () => {
          expect(location, "Координаты вызова в исходнике либо null при отсутствии доступного места").toEqual(
            location === null ? null : {
              path: expect.any(String),
              line: expect.any(Number),
              column: expect.any(Number),
            },
          )
        })

        /**
        @remarks
        При отсутствии места вызова нет исходного файла для отдельной проверки.
        */
        test.skipIf(location === null)("Файл", () => {
          expect(location?.path, "Исходный файл или имя источника вызова").not.toBeEmpty()
        })

        /**
        @remarks
        Номер строки проверяется только при наличии координат вызова.
        */
        test.skipIf(location === null)("Строка", () => {
          expect(location?.line, "Номер строки вызова, начиная с единицы").toSatisfy(
            value => typeof value === "number" && Number.isInteger(value) && value > 0,
          )
        })

        /**
        @remarks
        Номер столбца проверяется только при наличии координат вызова.
        */
        test.skipIf(location === null)("Столбец", () => {
          expect(location?.column, "Номер столбца вызова, начиная с единицы").toSatisfy(
            value => typeof value === "number" && Number.isInteger(value) && value > 0,
          )
        })
      })
    })
  })
})
