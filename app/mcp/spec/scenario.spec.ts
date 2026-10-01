import {expect, test} from "bun:test"
import {Client, InMemoryTransport} from "@modelcontextprotocol/client"
import {McpServer} from "@modelcontextprotocol/server"
import mcp from "@app/mcp"

test("lazy storybook передаёт полный предметный JSON без загрузки управления", async () => {
  const server = new McpServer({name: "storybook-subject-test", version: "1"})
  const calls: unknown[] = []
  const traced: unknown[] = []
  mcp.register(server, {
    request: async input => { calls.push(input); return {status: "failed", arbitrary: {items: [null, 0, false]}} },
    traceRequest: async (tool, input, execute) => {
      traced.push({tool, input})
      return execute()
    },
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({name: "storybook-subject-client", version: "1"})
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  try {
    const reply = await client.callTool({name: "storybook", arguments: {path: "library.v2"}})
    expect(reply.structuredContent).toEqual({status: "failed", arbitrary: {items: [null, 0, false]}})
    expect(reply.isError).not.toBeTrue()
    expect(JSON.parse((reply.content as {text: string}[])[0]!.text)).toEqual(reply.structuredContent)
    expect(calls).toEqual([{path: "library.v2"}])
    expect(traced).toEqual([{tool: "storybook", input: {path: "library.v2"}}])
    expect((await client.callTool({name: "storybook", arguments: {node: "library.v2"}})).isError).toBeTrue()
  } finally {
    await client.close()
    await server.close()
  }
})

test("HTTP-чтение и lazy-инструмент используют один предметный адрес", async () => {
  const response = await mcp.read(new Request("http://localhost/api/control/storybook", {
    method: "POST",
    body: JSON.stringify({path: "example"}),
  }), {entries: [{path: "example", parent: null, description: "Пример"}]})
  expect(await response.json()).toEqual({description: "Пример", path: "example", children: []})
})
