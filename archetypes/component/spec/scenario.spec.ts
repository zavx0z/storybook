/**
Проверяет самостоятельный публичный вход Component.
Частные исходники, состояние и применимость среды не создают другой структурный класс.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readComponent} from "@archetypes/component"

describe.each([{name: "Архетип Component", props: {path: resolve(import.meta.dir, "fixture/component")}}])("$name", async ({props}) => {
  const result = await readComponent(props)

  test("Класс Component", () => {
    expect(result.entries.length, "Компонент предоставляет собственный основной кодовый вход").toBeGreaterThan(0)
    expect(result.entries.every(entry => entry.exports.length === 1),
      "Каждая условная ветвь предоставляет одну основную runtime реализацию; type-only экспорты не считаются реализациями").toBeTrue()
  })
  test("Публичная граница", () => {
    expect(result.additionalCode, "Дополнительные самостоятельные реализации получают собственные пакеты").toEqual([])
    expect(result.entries.every(entry => /\/index\.tsx?$/u.test(entry.path)),
      "Основная реализация находится в index своего пакета").toBeTrue()
  })
  test("Исполняемое использование", () => {
    expect(result.scenarios.length, "Компонент имеет один непосредственный сценарий использования публичного API").toBe(1)
  })

  /** @remarks Визуальный компонент возвращает JSX и не требует отдельного выходного контракта данных. */
  describe.skipIf(result.entries.every(entry => entry.jsx))("Результат функции", () => {
    test("Выходной контракт", () => {
      expect(result.entries.filter(entry => !entry.jsx && entry.output === null),
        "Невизуальный результат описан выходным контрактом владельца").toEqual([])
    })
  })
})
