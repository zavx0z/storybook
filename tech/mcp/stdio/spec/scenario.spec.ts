/** Публичный владелец stdio создаёт и закрывает ровно одно соединение, освобождая свои обработчики. */
import {describe, expect, test} from "bun:test"
import {McpServer} from "@modelcontextprotocol/server"
import serve from "@zavx0z/storybook-tech-mcp-stdio"

describe.each([
  {name: "Первое соединение", props: {diagnosticLabel: "stdio-one"}},
  {name: "Второе соединение", props: {diagnosticLabel: "stdio-two"}},
])("$name", async ({props}) => {
  const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]
  const handle = serve({...props, createServer: () => new McpServer({name: props.diagnosticLabel, version: "1.0.0"})})
  const closing = handle.close()
  const same = handle.close() === closing
  await closing
  const after = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]
  test("Одно завершение", () => {
    expect(same, "Повторное закрытие разделяет тот же Promise освобождения транспорта").toBeTrue()
  })
  test("Освобождение обработчиков", () => {
    expect(after, "Владелец снимает свои сигнальные обработчики, сохраняя чужие").toEqual(before)
  })
})
