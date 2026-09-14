/**
Проверяет результат функции readScenario на серверном, компонентном и связанном наборе данных.
Это проверка реализации чтения, а не спецификация оформления сценариев.
SCENARIO_PATH задаёт внешний путь к сценарию вместо примера по умолчанию.
Относительный внешний путь разрешается от рабочей директории запуска тестов.
Вариант выбирается штатным фильтром Bun --test-name-pattern.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {isAbsolute, resolve} from "node:path"
import {readScenario, type ReadScenarioInput} from "@archetypes/specs/scenarios"
import {createFixture} from "../../../shared/fixtures"
import {inspectSnapshot} from "./fixture/snapshot"

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
  {
    name: "Трассировка связанных данных",
    props: {path: resolvePath("fixture/value-scenario.test.ts")},
    expected: [{name: "mixedValue", describe: ["Значения"], test: null, outcome: {type: "return"}}],
  },
] satisfies Scenario[])("$name", async ({props, expected}) => {
  const result = await readScenario(props)
  const snapshots = result.calls.flatMap(call => [
    {label: `${call.id}: ${call.name} — аргументы`, root: call.args},
    {
      label: `${call.id}: ${call.name} — ${"value" in call.outcome ? "значение" : "ошибка"}`,
      root: "value" in call.outcome ? call.outcome.value : call.outcome.error,
    },
  ]).map(snapshot => ({...snapshot, ...inspectSnapshot(snapshot.root)}))

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

    /**
    @remarks
    Имена вызовов относятся к примерам по умолчанию. Для внешнего SCENARIO_PATH
    этот пример не применяется; общий контракт результата проверяется полностью.
    */
    test.skipIf(process.env.SCENARIO_PATH !== undefined)("Группы и результаты", () => {
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

      test("Аргументы", () => {
        expect(call.args, "Позиционные аргументы на момент начала вызова").toBeArray()
      })

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
          test("Содержимое", () => {
            expect(error, "Данные ошибки в переносимом формате снимка").toBeOneOf([
              null, expect.any(String), expect.any(Number), expect.any(Boolean), expect.any(Object),
            ])
          })
        })

        /**
        @remarks
        Значение раскрывается только для return и resolve; ошибочный вызов его не возвращает.
        */
        describe.skipIf(failed)("Значение", () => {
          const value = "value" in outcome ? outcome.value : null
          test("Содержимое", () => {
            expect(value, "Возвращённые данные в переносимом формате снимка").toBeOneOf([
              null, expect.any(String), expect.any(Number), expect.any(Boolean), expect.any(Object),
            ])
          })
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
  describe("Формат снимков", () => {
    describe.each(snapshots)("$label", ({root, markers, references, escaped, invalidValues}) => {
      test("Содержимое", () => {
        expect(root, "Данные одного независимого снимка без очистки для представления").toBeOneOf([
          null, expect.any(String), expect.any(Number), expect.any(Boolean), expect.any(Object),
        ])
      })

      test("Переносимость", () => {
        expect(invalidValues, "Значения снимка без прямых циклов, getters и непереносимых JSON-значений").toEqual([])
      })

      describe("Ссылки", () => {
        test("Состав", () => {
          expect(references.map(item => item.value), "Ссылки на общие объекты внутри этого снимка").toEqual(
            references.map(() => ({$type: "reference", path: expect.any(Array)})),
          )
        })

        describe.each(references)("$label", ({value, resolved, targetIsObject}) => {
          test("Ключи", () => {
            expect(value, "Вид служебной записи и путь к сохранённому объекту").toEqual({
              $type: "reference",
              path: expect.any(Array),
            })
          })

          test("Путь", () => {
            expect(value.path, "Ключи объектов и индексы массивов от корня снимка; пустой путь обозначает корень").toSatisfy(
              path => Array.isArray(path) && path.every(segment => typeof segment === "string"
                || (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0)),
            )
          })

          test("Цель", () => {
            expect({resolved, targetIsObject}, "Существующий объект данных этого снимка, без перехода в прототип или другую ссылку").toEqual({
              resolved: true,
              targetIsObject: true,
            })
          })
        })
      })

      describe("Экранированные объекты", () => {
        test("Состав", () => {
          expect(escaped.map(item => item.value), "Пользовательские объекты с собственным полем $type").toEqual(
            escaped.map(() => ({$type: "object", value: expect.any(Object)})),
          )
        })

        describe.each(escaped)("$label", ({value}) => {
          test("Ключи", () => {
            expect(value, "Обёртка, отделяющая пользовательский объект от служебных меток").toEqual({
              $type: "object",
              value: expect.any(Object),
            })
          })

          test("Поля пользователя", () => {
            expect(value.value, "Исходные поля объекта, включая пользовательский $type").toSatisfy(
              fields => fields !== null && typeof fields === "object" && !Array.isArray(fields)
                && Object.hasOwn(fields, "$type"),
            )
          })
        })
      })

      describe("Специальные значения", () => {
        describe.each(markers.filter(item => item.type !== "reference" && item.type !== "object"))(
          "$label",
          ({type, value}) => {
            test("Вид", () => {
              expect(type, "Виды значений, которым требуется служебное представление").toBeOneOf([
                "undefined", "bigint", "symbol", "function", "error", "date",
                "accessor", "promise", "unreadable", "unsupported",
              ])
            })

            test("Ключи", () => {
              const formats: Record<string, Record<string, unknown>> = {
                undefined: {$type: "undefined"},
                bigint: {$type: "bigint", value: expect.any(String)},
                symbol: {$type: "symbol", value: expect.any(String)},
                function: {$type: "function", name: expect.any(String)},
                error: {$type: "error", name: expect.any(String), message: expect.any(String)},
                date: {$type: "date", value: expect.any(String)},
                accessor: {
                  $type: "accessor",
                  get: value.get === null ? null : expect.any(String),
                  set: value.set === null ? null : expect.any(String),
                },
                promise: value.status === "fulfilled"
                  ? {$type: "promise", status: "fulfilled", value: value.value === null ? null : expect.anything()}
                  : {$type: "promise", status: "rejected", error: value.error === null ? null : expect.anything()},
                unreadable: {$type: "unreadable", error: value.error === null ? null : expect.anything()},
                unsupported: {$type: "unsupported", value: expect.any(String)},
              }

              expect(value, "Полный состав служебной записи выбранного вида").toEqual(formats[type]!)
            })

            /**
            @remarks
            Числовая запись проверяется только у метки bigint.
            */
            test.skipIf(type !== "bigint")("Целое число", () => {
              expect(value.value, "Десятичная запись целого числа без ограничения точности JSON Number").toMatch(/^-?(?:0|[1-9]\d*)$/)
            })

            /**
            @remarks
            Временная метка присутствует только у date.
            */
            test.skipIf(type !== "date")("Дата", () => {
              expect(value.value, "Дата в полном формате ISO UTC").toSatisfy(
                date => typeof date === "string" && Number.isFinite(Date.parse(date))
                  && new Date(date).toISOString() === date,
              )
            })

            /**
            @remarks
            Состояние завершения относится только к Promise.
            */
            test.skipIf(type !== "promise")("Состояние Promise", () => {
              expect(value.status, "Полученное значение либо причина отклонения Promise").toBeOneOf(["fulfilled", "rejected"])
            })

            /**
            @remarks
            Имена getter и setter относятся только к accessor.
            */
            test.skipIf(type !== "accessor")("Accessor", () => {
              expect({get: value.get, set: value.set}, "Имена getter и setter без выполнения их кода").toSatisfy(
                item => (item.get === null || typeof item.get === "string")
                  && (item.set === null || typeof item.set === "string")
                  && (item.get !== null || item.set !== null),
              )
            })
          },
        )
      })
    })
  })
})
