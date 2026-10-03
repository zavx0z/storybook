import {expect, test} from "bun:test"
import {Client, InMemoryTransport} from "@modelcontextprotocol/client"
import type {AppMcp} from "@app/mcp"
import {createAppMcpServer} from "./mcp.ts"

test("app передаёт контроллер MCP без загрузки при предметном чтении и сохраняет request progress", async () => {
  let loads = 0
  const calls: unknown[] = []
  const progress: {progress: number, message?: string | undefined}[] = []
  /** Остальные управляющие входы присутствуют, но этот пример использует только check. */
  const unused = async () => ({status: "success" as const})
  const controller: NonNullable<AppMcp.Input["controller"]> = {
    ensure: unused,
    status: unused,
    attach: unused,
    detach: unused,
    search: unused,
    open: unused,
    wait: unused,
    inspect: unused,
    interact: unused,
    capture: unused,
    close: unused,
    stop: unused,
    async readResource(uri) { return {status: "success", uri, mimeType: "application/json"} },
    async check(input, context) {
      calls.push(input)
      await context.onProgress?.({phase: "prepared", at: 12, operationId: "web-1"})
      await context.onProgress?.({phase: "published", at: 14, operationId: "web-1"})
      return {status: "success" as const, ok: true, published: true, applied: false}
    },
  }
  const server = createAppMcpServer({
    controllerFactory: () => { loads += 1; return controller },
    request: async () => ({description: "Предметный ответ", children: []}),
    recordRequest: async () => {},
  })
  const client = new Client({name: "web-rebuild-test", version: "1"})
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  try {
    expect((await client.listTools()).tools.map(tool => tool.name)).toContain("storybook_rebuild_web")
    const lazy = await client.callTool({name: "storybook", arguments: {}})
    expect(lazy.structuredContent).toEqual({description: "Предметный ответ", children: []})
    expect(loads).toBe(0)
    const rebuilt = await client.callTool({name: "storybook_rebuild_web", arguments: {}}, {
      onprogress: value => { progress.push(value) },
    })
    expect(rebuilt.structuredContent).toEqual({status: "success", ok: true, published: true, applied: false})
    expect(calls).toEqual([{schemaVersion: 1, scope: "storybook:web", live: true}])
    expect(progress.map(value => value.progress)).toEqual([1, 2])
    expect(progress.map(value => JSON.parse(value.message!))).toEqual([
      {phase: "prepared", at: 12, operationId: "web-1"},
      {phase: "published", at: 14, operationId: "web-1"},
    ])
    expect(loads).toBe(1)
    await client.callTool({name: "storybook_check", arguments: {schemaVersion: 1, scope: "storybook:web", live: false, timeoutMs: 1000}}, {
      onprogress: value => { progress.push(value) },
    })
    expect(calls[1]).toEqual({schemaVersion: 1, scope: "storybook:web", live: false, timeoutMs: 1000})
    expect(progress.slice(2).map(value => value.progress)).toEqual([1, 2])
    await client.callTool({name: "storybook_rebuild_web", arguments: {live: false, timeoutMs: 1000}})
    expect(calls[2]).toEqual({schemaVersion: 1, scope: "storybook:web", live: false, timeoutMs: 1000})
    const invalid = await client.callTool({name: "storybook_rebuild_web", arguments: {unexpected: true}})
    expect(invalid.isError).toBeTrue()
    expect(calls).toHaveLength(3)
    expect(loads, "Встроенные и добавленные инструменты используют один отложенный контроллер").toBe(1)
  } finally {
    await client.close()
    await server.close()
  }
})
