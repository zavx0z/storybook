/** Журнал MCP хранит последние обращения и раскрывает краткую сводку. */
import {describe, expect, test} from "bun:test"
import createMcpRequestJournal from "@mcp-rest/requests"

describe.each([
  {name: "Один запрос", props: {records: [{id: "one", tool: "storybook_status", startedAt: 1, status: "success", input: "{}", result: "ok"}]}},
  {name: "Два запроса", props: {records: [
    {id: "one", tool: "storybook_status", startedAt: 1, status: "success", input: "{}", result: "ok"},
    {id: "two", tool: "storybook_search", startedAt: 2, status: "running", input: "name", result: ""},
  ]}},
])("$name", ({props}) => {
  const journal = createMcpRequestJournal()
  for (const record of props.records) journal.write(record)
  const records = journal.read()
  const summary = journal.summary()

  test("Порядок чтения", () => {
    expect(records.map(record => record.id), "Последнее обращение показывается первым").toEqual(props.records.map(record => record.id).reverse())
  })
  test("Сводка без содержимого", () => {
    expect(summary.map(record => ({id: record.id, inputBytes: record.inputBytes, resultBytes: record.resultBytes})),
      "Сводка сохраняет идентичность и размер UTF-8 вместо повторной передачи тела"
    ).toEqual(props.records.map(record => ({
      id: record.id,
      inputBytes: Buffer.byteLength(record.input),
      resultBytes: Buffer.byteLength(record.result),
    })).reverse())
  })
})
