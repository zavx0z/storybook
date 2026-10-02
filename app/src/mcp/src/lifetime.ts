import type {McpServer} from "@modelcontextprotocol/server"

/** Закрытие SDK отменяет запросы; фабрика дополнительно ожидает cleanup своих операций. */
export function retainRequestLifetime(server: McpServer) {
  const pending = new Set<Promise<unknown>>()
  let closed = false
  let closing: Promise<void> | null = null
  const nativeClose = server.close.bind(server)
  server.close = () => {
    closing ??= (async () => {
      closed = true
      try {
        await nativeClose()
      } finally {
        while (pending.size > 0) await Promise.allSettled([...pending])
      }
    })()
    return closing
  }
  return <Result>(operation: () => Promise<Result>): Promise<Result> => {
    if (closed) return Promise.reject(new DOMException("MCP server is closing", "AbortError"))
    const request = Promise.resolve().then(operation)
    pending.add(request)
    void request.then(() => pending.delete(request), () => pending.delete(request))
    return request
  }
}
