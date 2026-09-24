import type {McpAddressSource} from "../workbench/mcp-window/src/address-request"

/** Читает MCP-ответ текущего URL через browser-сессию, без управляющего токена и записи в журнал агента. */
export function createMcpAddressSource(readAddress: () => string, fetcher: typeof fetch = fetch): McpAddressSource {
  return {
    readAddress,
    async request(address, signal) {
      const session = await fetcher("/api/browser/registry-session", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: "{}",
        signal,
      })
      if (!session.ok) throw new Error("Не удалось открыть сессию MCP для текущего адреса")
      const {readerToken} = await session.json()
      const response = await fetcher("/api/browser/mcp-address", {
        method: "POST",
        headers: {"content-type": "application/json", "x-storybook-session": readerToken},
        body: JSON.stringify({address}),
        signal,
      })
      if (!response.ok) throw new Error(`Не удалось прочитать MCP-ответ: HTTP ${response.status}`)
      const reply = await response.json()
      return {input: reply.input, result: reply.structuredContent, failed: reply.isError === true}
    },
  }
}
