/**
Проверяет интеграцию readScenario с настоящим Bun Test и его инспектором.
На контрольном сценарии подтверждает завершение процесса, пять событий результата
и доступ к локальным данным. Для проверки состава публичного результата предназначен spec.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"

describe.each([
  {name: "Инспектор Bun", props: {
    path: resolve(import.meta.dir, "../../../package/package-json/spec/scenario.spec.ts"),
  }},
])("$name", ({props}) => {
  describe.each([
    {runtime: async () => {
      const {readScenario} = await import("@archetypes/specs/scenarios")
      return readScenario(props)
    }},
  ])("Исполнение и сбор", async ({runtime}) => {
    const result = await runtime()

    test("Настоящий Bun Test завершился успешно", () => {
      expect(result.exitCode).toBe(0)
    })

    test("TestReporter сообщил результаты всех пяти тестов", () => {
      expect(result.events.filter(event => event.method === "TestReporter.end").map(event => event.params.status))
        .toEqual(["pass", "pass", "pass", "pass", "pass"])
    })

    test("В точках остановки доступны локальные данные", () => {
      expect(JSON.stringify(result.pauses)).toContain('"fields"')
    })
  })
})
