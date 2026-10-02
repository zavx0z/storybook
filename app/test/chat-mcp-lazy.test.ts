import {expect, test} from "bun:test"
import {Client} from "@modelcontextprotocol/client"
import {getDefaultEnvironment, StdioClientTransport} from "@modelcontextprotocol/client/stdio"
import {fileURLToPath} from "node:url"

/** Scoped factory не заменяется общим управляющим сервером при переходе на lazy. */
test("lazy MCP чата сохраняет grant и не предоставляет управление приложением", async () => {
  const requests: {path: string, authorization: string | null, body: unknown}[] = []
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push({path: new URL(request.url).pathname, authorization: request.headers.get("authorization"), body: await request.json()})
      return Response.json({label: "Scoped component", children: []})
    },
  })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../src/chat-mcp.ts", import.meta.url))],
    cwd: "/tmp",
    env: {...getDefaultEnvironment(), STORYBOOK_CHAT_ORIGIN: http.url.origin, STORYBOOK_CHAT_KEY: "fixture-grant"},
    stderr: "pipe",
  })
  const client = new Client({name: "scoped-chat-fixture", version: "1"})
  try {
    await client.connect(transport)
    const {tools} = await client.listTools()
    expect(tools.map(tool => tool.name), "Сессия получает только свой предметный вход").toEqual(["storybook"])
    expect(tools[0]?.annotations?.readOnlyHint).toBeTrue()
    expect((await client.callTool({name: "storybook", arguments: {path: "component"}})).structuredContent)
      .toEqual({label: "Scoped component", children: []})
    expect(requests).toEqual([{path: "/api/chat/mcp", authorization: "Bearer fixture-grant", body: {path: "component"}}])
    await expect(client.callTool({name: "storybook_ensure", arguments: {schemaVersion: 1}}),
      "Управляющий handler отсутствует, вместо вызова App или общего HTTP control").rejects.toThrow()
    expect(requests).toHaveLength(1)
  } finally {
    await client.close()
    await transport.close()
    http.stop(true)
  }
}, 20_000)
