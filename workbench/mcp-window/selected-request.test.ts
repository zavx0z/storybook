import {describe, expect, test} from "bun:test"
import {selectRequest} from "./src/selected-request"
import type {McpRequestRecord} from "@mcp/rest/requests"

describe("Выбранная команда журнала", () => {
  const entries: McpRequestRecord[] = Array.from({length: 20}, (_, index) => ({
    id: String(index), tool: "storybook", startedAt: 20 - index, durationMs: 1,
    status: "success", input: "{}", result: JSON.stringify({text: "данные".repeat(25000), end: index}),
  }))

  test("по умолчанию выводится одна последняя команда целиком", () => {
    expect(selectRequest(entries, null)).toEqual({entry: entries[0]!, index: 0, olderId: "1", newerId: null})
    expect(selectRequest(entries, null).entry).toBe(entries[0]!)
  })
  test("любая команда доступна без усечения ответа", () => {
    const selected = selectRequest(entries, "15")
    expect(selected).toEqual({entry: entries[15]!, index: 15, olderId: "16", newerId: "14"})
    expect(JSON.parse(selected.entry!.result)).toEqual({text: "данные".repeat(25000), end: 15})
  })
  test("новый запрос не подменяет выбранную команду", () => {
    const next = [{...entries[0]!, id: "new"}, ...entries]
    expect(selectRequest(next, "15").entry).toBe(entries[15]!)
    expect(selectRequest(next, null).entry?.id).toBe("new")
  })
  test("завершение выбранной команды обновляет ответ", () => {
    expect(selectRequest([{...entries[0]!, status: "running", result: ""}], "0").entry?.status).toBe("running")
    expect(selectRequest(entries, "0").entry?.result).toBe(entries[0]!.result)
  })
  test("пустая история и вытесненная команда не оставляют старые данные", () => {
    expect(selectRequest([], "gone")).toEqual({entry: null, index: 0, olderId: null, newerId: null})
    expect(selectRequest(entries, "gone").entry).toBe(entries[0]!)
  })
})
