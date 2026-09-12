/**
Проверяет сбор через readScenario на сценарии package.json.
Каркас предназначен для проверок данных публичного результата.
Проверки внутреннего механизма находятся в test.

@packageDocumentation
*/
import {describe, test} from "bun:test"
import {resolve} from "node:path"

const scenarioPath = (path: string) => resolve(import.meta.dir, "../../..", path)
const inputPath = process.env.SPEC_PATH

describe.each([
  {
    name: "Чтение сценария",
    props: {
      path: inputPath ?? scenarioPath("package/package-json/spec/scenario.spec.ts"),
    },
  },
])("$name", ({props}) => {
  describe.each([
    {
      runtime: async () => {
        const {readScenario} = await import("@archetypes/specs/scenarios")
        return readScenario(props)
      },
    },
  ])("Исполнение и сбор сценария", async ({runtime}) => {
    const result = await runtime()

    /**
    @remarks
    Проверки механизма перенесены в test. Требования к данным результата
    этого сценария предстоит определить отдельно.
    */
    test.todo("Данные прочитанного сценария", () => {})
  })
})
