/** Адресная сессия раскрывает чтение и инструменты только назначенной сущности. */
import {McpServer, fromJsonSchema} from "@modelcontextprotocol/server"
import type {StorybookAppMcpTools} from "@zavx0z/storybook-app-mcp-tools"
import {register} from "./subject"
import {retainRequestLifetime} from "./lifetime"

export default async function createChatMcpServer(options: {origin?: string, key?: string, fetch?: typeof fetch} = {}) {
  const origin = options.origin ?? process.env.STORYBOOK_CHAT_ORIGIN
  const key = options.key ?? process.env.STORYBOOK_CHAT_KEY
  const request = options.fetch ?? fetch
  if (origin === undefined || key === undefined) throw new Error("Не задан контекст MCP-подключения чата")
  const url = new URL("/api/chat/mcp", origin)
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("MCP чата подключается к локальному серверу Project")
  }
  const server = new McpServer({name: "storybook", version: "1.0.0"})
  const run = retainRequestLifetime(server)
  register(server, {
    request(input, signal) {
      return run(async () => {
        const response = await request(url, {
          method: "POST",
          headers: {"content-type": "application/json", authorization: `Bearer ${key}`},
          body: JSON.stringify(input),
          signal,
        })
        const value = await response.json() as Record<string, unknown>
        if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : `MCP: HTTP ${response.status}`)
        return value
      })
    },
  })
  const toolsUrl = new URL("/api/chat/tools", origin)
  const headers = {"content-type": "application/json", authorization: `Bearer ${key}`}
  const catalog = await request(toolsUrl, {headers})
  if (!catalog.ok) throw new Error(`Не удалось получить инструменты сущности: HTTP ${catalog.status}`)
  const {tools} = await catalog.json() as {tools: ReturnType<StorybookAppMcpTools.Output["list"]>}
  if (!Array.isArray(tools)) throw new Error("Нет каталога инструментов сущности")
  const names = new Set(["storybook"])
  for (const tool of tools) {
    if (names.has(tool.name)) throw new Error(`Повтор имени MCP-инструмента: ${tool.name}`)
    names.add(tool.name)
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema),
      outputSchema: fromJsonSchema(tool.outputSchema),
      annotations: tool.annotations,
    }, (input, context) => run(async () => {
      const response = await request(toolsUrl, {
        method: "POST", headers, body: JSON.stringify({name: tool.name, arguments: input}), signal: context.mcpReq.signal,
      })
      const value = await response.json() as {result?: Record<string, unknown>, error?: Record<string, unknown>}
      if (!response.ok) return {isError: true, content: [{type: "text", text: JSON.stringify(value.error ?? {message: `HTTP ${response.status}`})}]}
      if (value.result === undefined) throw new Error("Нет результата инструмента")
      return {content: [{type: "text", text: JSON.stringify(value.result)}], structuredContent: value.result}
    }))
  }
  return server
}
