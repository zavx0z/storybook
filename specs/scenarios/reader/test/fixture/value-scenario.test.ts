/**
Исполняемый вход инспектора с общими ссылками, циклом и пользовательским $type.
Этот файл запускается readScenario как отдельный сценарий.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {mixedValue} from "./value-functions"

describe.each([{name: "Значения"}])("$name", () => {
  const result = mixedValue()

  test("Общий объект", () => {
    expect(result.first, "Один объект в двух полях результата").toBe(result.second)
  })

  test("Цикл", () => {
    expect(result.self, "Ссылка результата на самого себя").toBe(result)
  })
})
