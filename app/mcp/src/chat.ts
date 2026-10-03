/** Адресная сессия сохраняет только выданные сервером права чтения. */
import {McpServer} from "@modelcontextprotocol/server"
import {register} from "./subject"
import {retainRequestLifetime} from "./lifetime"

export default function createChatMcpServer() {
  const origin = process.env.STORYBOOK_CHAT_ORIGIN
  const key = process.env.STORYBOOK_CHAT_KEY
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
        const response = await fetch(url, {
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
  return server
}
