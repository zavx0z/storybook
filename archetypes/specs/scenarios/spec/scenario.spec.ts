/**
Описывает результаты чтения серверного и компонентного сценариев.
Полная история каждого варианта сохраняется штатным snapshot-механизмом Bun.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario, type ReadScenarioInput} from "@archetypes/specs/scenarios"

const archetypes = resolve(import.meta.dir, "../../..")
const webxr = resolve(archetypes, "../../webxr-space")

type Scenario = {
  name: string
  props: ReadScenarioInput
  expected: {name: string, describe: string[], test: string | null, outcome: {type: string}}[]
}

describe.each([
  {
    name: "Трассировка серверной функции",
    props: {
      path: resolve(archetypes, "package/spec/scenario.spec.ts"),
    },
    expected: ["Корневой пакет", "Вложенный пакет"].map(name => ({
      name: "readPackage", describe: [name], test: null, outcome: {type: "resolve"},
    })),
  },
  {
    name: "Трассировка компонента",
    props: {
      path: resolve(webxr, "nodes/node/diagram/spec/scenario.spec.tsx"),
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
    expect(result, "Результат должен содержать ровно ключи path, exitCode, stdout, stderr и calls с ожидаемыми типами значений").toEqual({
      path: expect.any(String),
      exitCode: expect.any(Number),
      stdout: expect.any(String),
      stderr: expect.any(String),
      calls: expect.any(Array),
    })
  })

  test("path содержит абсолютный путь исполненного сценария", () => {
    expect(result.path, "Путь результата должен соответствовать переданному сценарию").toBe(resolve(props.path))
  })

  test("exitCode подтверждает успешное завершение сценария", () => {
    expect(result.exitCode, "Положительный сценарий должен завершиться без ошибок").toBe(0)
  })

  test("stdout содержит стандартный вывод Bun Test", () => {
    expect(result.stdout, "Стандартный вывод должен содержать заголовок запущенного Bun Test").toContain("bun test")
  })

  test("stderr содержит отчёт о выполненных тестах", () => {
    expect(result.stderr, "Диагностический вывод должен содержать итоги успешного сценария").toMatch(/\d+ pass\s+0 fail/)
  })

  test("calls содержит историю фактических вызовов", () => {
    expect(result.calls.length, "Исполнение сценария должно дать наблюдаемые вызовы").toBeGreaterThan(0)
  })

  test("содержит вызовы с группами и результатами", () => {
    const calls = result.calls.filter(call => expected.some(item => item.name === call.name))

    expect(calls, "История должна содержать вызовы выбранного сценария").toMatchObject(expected)
  })

  test("Соответствие результата снимку", () => {
    const snapshot = {
      ...result,
      stderr: result.stderr.replace(/ \[\d+(?:\.\d+)?(?:ms|s)\]/g, ""),
    }

    expect(snapshot, "Результат должен совпадать с сохранённым снимком").toMatchSnapshot()
  })
})
