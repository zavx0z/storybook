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

  test("содержит вызовы с группами и результатами", () => {
    const calls = result.calls.filter(call => expected.some(item => item.name === call.name))

    expect(calls, "История должна содержать вызовы выбранного сценария").toMatchObject(expected)
  })

  test("сохраняет полный результат", () => {
    const snapshot = {
      ...result,
      stderr: result.stderr.replace(/ \[\d+(?:\.\d+)?(?:ms|s)\]/g, ""),
    }

    expect(snapshot, "Результат должен совпадать с сохранённым снимком").toMatchSnapshot()
  })
})
