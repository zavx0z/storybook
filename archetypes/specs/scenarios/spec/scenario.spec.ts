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
    expect(result, "Состав полей показывает, какие данные о выполнении сценария доступны человеку и агенту").toEqual({
      path: expect.any(String),
      exitCode: expect.any(Number),
      stdout: expect.any(String),
      stderr: expect.any(String),
      calls: expect.any(Array),
    })
  })

  test("Путь сценария", () => {
    expect(result.path, "Путь позволяет связать результат с исполненным файлом сценария").toBe(resolve(props.path))
  })

  test("Код завершения", () => {
    expect(result.exitCode, "По коду завершения определяется, закончился ли запуск сценария без ошибок").toBe(0)
  })

  test("Стандартный вывод", () => {
    expect(result.stdout, "Сообщения процесса сохраняются для просмотра того, что Bun Test вывел во время запуска").toContain("bun test")
  })

  test("Диагностический вывод", () => {
    expect(result.stderr, "Диагностический отчёт нужен для разбора итогов проверок и причин ошибок сценария").toMatch(/\d+ pass\s+0 fail/)
  })

  test("Количество вызовов", () => {
    expect(result.calls.length, "По количеству вызовов видно, собрала ли трассировка записи выполнения").toBeGreaterThan(0)
  })

  test("Вызовы с группами и результатами", () => {
    const calls = result.calls.filter(call => expected.some(item => item.name === call.name))

    expect(calls, "Связь вызовов с группами, тестами и исходами показывает, что выполнилось в каждом варианте и чем завершилось").toMatchObject(expected)
  })

  test("Полный результат", () => {
    const snapshot = {
      ...result,
      stderr: result.stderr.replace(/ \[\d+(?:\.\d+)?(?:ms|s)\]/g, ""),
    }

    expect(snapshot, "Полные данные сохраняются для разбора результата и выявления изменений, пока отдельные проверки ещё формируются").toMatchSnapshot()
  })
})
