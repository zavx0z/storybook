/**
Проверяет сбор через readScenario на сценарии package.json.
Каркас предназначен для проверок данных публичного результата.
Проверки внутреннего механизма находятся в test.

@packageDocumentation
*/
import {describe, test, mock} from "bun:test"
import {resolve} from "node:path"

const readScenarioMock = mock(async (input: {path: string}) => {
  const {readScenario} = await import("@archetypes/specs/scenarios")
  return readScenario(input)
})

const scenarioPath = (path: string) => resolve(import.meta.dir, "../../..", path)
const inputPath = process.env.SPEC_PATH

describe.each([
  {
    name: "Чтение сценария",
    props: {
      path: inputPath ?? scenarioPath("package/package-json/spec/scenario.spec.ts"),
    },
  },
])("$name", async ({props}) => {
  const result = await readScenarioMock(props)

  /**
  @remarks
  Проверки механизма перенесены в test. Требования к данным результата
  этого сценария предстоит определить отдельно.
  */
  test.todo("Данные прочитанного сценария", () => {})
})
