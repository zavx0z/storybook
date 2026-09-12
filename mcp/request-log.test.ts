import {describe, expect, test} from "bun:test"
import {traceMcpRequest} from "./request-log"
import {createMcpRequestJournal} from "@mcp/rest/requests"

describe("Журнал MCP", () => {
  test("сохраняет полный запрос и ответ длиннее прежнего ограничения", async () => {
    const journal = createMcpRequestJournal()
    const input = {node: "validator", text: "я".repeat(17000)}
    const result = {status: "success", nested: {text: "а".repeat(18000)}, items: [true, null, 42]}
    const returned = await traceMcpRequest("storybook", input, async () => result, async entry => journal.write(entry))
    const [entry] = journal.read()
    expect(returned).toBe(result)
    expect(JSON.parse(entry!.input)).toEqual(input)
    expect(JSON.parse(entry!.result)).toEqual(result)
    expect(entry!.status).toBe("success")
  })

  test("снимок остаётся в ответе MCP, а журнал хранит ссылку без base64", async () => {
    const journal = createMcpRequestJournal()
    const result = {status: "success", captureId: "capture_fixture", image: {mimeType: "image/png", data: "a".repeat(200000)}}
    const returned = await traceMcpRequest("storybook_capture", {}, async () => result, async entry => {
      expect(JSON.stringify(entry).length).toBeLessThan(65536)
      journal.write(entry)
    })
    expect(returned).toBe(result)
    expect(journal.read()[0]).toMatchObject({status: "success", captureId: "capture_fixture"})
    expect(JSON.parse(journal.read()[0]!.result)).toEqual({status: "success", captureId: "capture_fixture"})
  })

  test("журнал сохраняет только последние двадцать запросов", () => {
    const journal = createMcpRequestJournal()
    for (let index = 0; index < 25; index++) journal.write({id: String(index), tool: "storybook", startedAt: index, status: "success", input: "{}", result: "{}"})
    expect(journal.read().map(entry => entry.id)).toEqual(Array.from({length: 20}, (_, index) => String(24 - index)))
  })

  test("ошибка записывается как JSON и возвращается вызывающему коду", async () => {
    const journal = createMcpRequestJournal()
    await expect(traceMcpRequest("storybook", {}, async () => {throw new Error("Нет раздела")}, async entry => journal.write(entry)))
      .rejects.toThrow("Нет раздела")
    expect(JSON.parse(journal.read()[0]!.result)).toEqual({error: "Нет раздела"})
    expect(journal.read()[0]!.status).toBe("failed")
  })
})
