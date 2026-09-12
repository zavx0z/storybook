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

  test("ошибка записывается как JSON и возвращается вызывающему коду", async () => {
    const journal = createMcpRequestJournal()
    await expect(traceMcpRequest("storybook", {}, async () => {throw new Error("Нет раздела")}, async entry => journal.write(entry)))
      .rejects.toThrow("Нет раздела")
    expect(JSON.parse(journal.read()[0]!.result)).toEqual({error: "Нет раздела"})
    expect(journal.read()[0]!.status).toBe("failed")
  })
})
