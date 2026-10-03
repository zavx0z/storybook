/**
Один SDK connection продолжает работу после правки transitive реализации.
Trusted default factory и его зависимости находятся в подготовленном workspace;
проверки вызывают обычные tools/list и tools/call через публичный lazy server.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import createLazyMcpServer from "@mcp/lazy"
import {connectLazyFixture, createLazyFixture} from "../test/fixture"

describe.each([{name: "Свежая реализация в том же MCP", props: {text: "hello"}}])("$name", async ({props}) => {
  const fixture = createLazyFixture()
  const server = createLazyMcpServer(fixture.options)
  const connection = await connectLazyFixture(fixture, server)
  let before: Awaited<ReturnType<typeof connection.client.callTool>>
  let after: Awaited<ReturnType<typeof connection.client.callTool>>
  let connected: boolean[]
  try {
    await connection.client.listTools()
    before = await connection.client.callTool({name: "echo", arguments: props})
    connected = [connection.server.isConnected()]
    fixture.updateHandler("v2")
    after = await connection.client.callTool({name: "echo", arguments: props})
    connected.push(connection.server.isConnected())
  } finally {
    await connection.close()
    fixture.dispose()
  }

  test("Ответ до изменения", () => {
    expect(before.structuredContent, "Первый native tools/call исполняет исходный transitive handler")
      .toEqual({version: "v1", value: "hello"})
  })
  test("Ответ после изменения", () => {
    expect(after.structuredContent, "Следующий вызов того же Client исполняет изменённый handler без переподключения")
      .toEqual({version: "v2", value: "hello"})
  })
  test("Непрерывность транспорта", () => {
    expect(connected, "Один parent SDK server остаётся подключённым между вызовами")
      .toEqual([true, true])
  })
})
