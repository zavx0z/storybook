/**
Сохраняет одно MCP-соединение, передавая каждый запрос свежему исполнителю.
SDK владеет протоколом, а module worker предоставляет текущие инструменты,
их схемы, metadata, результаты и ресурсы. Transport не импортирует handlers
и не сохраняет предметные регистрации. Отмена относится к отдельному запросу;
завершение соединения освобождает все его worker и наблюдение за исходниками.

@packageDocumentation
*/
import {McpServer, type CallToolResult, type ListToolsResult, type ListResourcesResult, type ListResourceTemplatesResult, type ReadResourceResult, type ServerContext} from "@modelcontextprotocol/server"
import {isAbsolute} from "node:path"
import {executeLazyRequest} from "./src/execute"
import {watchSourceChanges} from "./src/notifications"
import {MCP_REQUEST_TIMEOUT_MS} from "./src/protocol"
import type {McpLazy} from "./contract"
export type {McpLazy} from "./contract"

/**
Создаёт только transport и стандартные protocol handlers.

@param input - Доверенные пути и срок выполнения из {@link McpLazy.Input}.
@returns SDK server, который подключается штатным connect или serveStdio.
@throws TypeError При относительных или пустых обязательных путях.
@throws RangeError При неположительном бюджете или превышении 15 минут.
*/
export default function createLazyMcpServer(input: McpLazy.Input): McpLazy.Output {
  for (const [name, path] of Object.entries({serverModule: input.serverModule, cwd: input.cwd, temporaryRoot: input.temporaryRoot})) {
    if (typeof path !== "string" || !isAbsolute(path)) throw new TypeError(`MCP lazy ${name} must be an absolute trusted path`)
  }
  const timeoutMs = input.timeoutMs ?? MCP_REQUEST_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MCP_REQUEST_TIMEOUT_MS) throw new RangeError("MCP lazy timeoutMs must be positive and at most 900000 ms")
  const server = new McpServer({name: input.name ?? "lazy-mcp", version: input.version ?? "1.0.0"}, {
    capabilities: {tools: {listChanged: true}, resources: {listChanged: true}},
  })
  const active = new Set<AbortController>()
  const pending = new Set<Promise<Record<string, unknown>>>()
  let closed = false
  let closeWatcher = () => {}
  let closing: Promise<void> | null = null
  const reportError = (error: unknown): void => {
    const diagnostic = error instanceof Error ? error : new Error(String(error))
    try {
      if (server.server.onerror !== undefined) server.server.onerror(diagnostic)
      else process.stderr.write(`[mcp-lazy] ${diagnostic.message.replace(/[\r\n]+/gu, " ").slice(0, 4096)}\n`)
    } catch {
      process.stderr.write("[mcp-lazy] diagnostic callback failed\n")
    }
  }
  const release = (): void => {
    if (closed) return
    closed = true
    closeWatcher()
    for (const controller of active) controller.abort(new DOMException("MCP connection closed", "AbortError"))
  }
  const nativeClose = server.close.bind(server)
  server.close = () => {
    if (closing === null) {
      release()
      closing = nativeClose().finally(async () => {
        await Promise.allSettled([...pending])
      })
    }
    return closing
  }
  const nativeOnClose = server.server.onclose
  server.server.onclose = () => {
    release()
    nativeOnClose?.()
  }
  const executeRequest = async (
    method: "tools/list" | "tools/call" | "resources/list" | "resources/templates/list" | "resources/read",
    params: Record<string, unknown>,
    context: ServerContext,
  ): Promise<Record<string, unknown>> => {
    if (closed) throw new DOMException("MCP connection closed", "AbortError")
    const controller = new AbortController()
    const cancel = () => controller.abort(context.mcpReq.signal.reason)
    if (context.mcpReq.signal.aborted) cancel()
    else context.mcpReq.signal.addEventListener("abort", cancel, {once: true})
    active.add(controller)
    const timer = setTimeout(() => controller.abort(new DOMException("MCP lazy request timed out", "TimeoutError")), timeoutMs)
    let progress = Promise.resolve()
    const progressToken = context.mcpReq._meta?.progressToken
    try {
      return await executeLazyRequest({
        serverModule: input.serverModule,
        cwd: input.cwd,
        temporaryRoot: input.temporaryRoot,
        method,
        params,
        signal: controller.signal,
        ...(typeof progressToken === "string" || typeof progressToken === "number" ? {
          onProgress(event) {
            const notification = progress.then(async () => {
              if (controller.signal.aborted) return
              await context.mcpReq.notify({
                method: "notifications/progress",
                params: {
                  progressToken,
                  progress: event.progress,
                  ...(event.total === undefined ? {} : {total: event.total}),
                  ...(event.message === undefined ? {} : {message: event.message}),
                },
              })
            })
            progress = notification.catch(reportError)
            return notification
          },
        } : {}),
      })
    } finally {
      await progress
      clearTimeout(timer)
      context.mcpReq.signal.removeEventListener("abort", cancel)
      active.delete(controller)
    }
  }
  const execute = (...args: Parameters<typeof executeRequest>): ReturnType<typeof executeRequest> => {
    const request = executeRequest(...args)
    pending.add(request)
    void request.then(() => pending.delete(request), () => pending.delete(request))
    return request
  }
  server.server.setRequestHandler("tools/list", (request, context) =>
    execute("tools/list", request.params ?? {}, context) as unknown as Promise<ListToolsResult>)
  server.server.setRequestHandler("tools/call", (request, context) =>
    execute("tools/call", request.params, context) as unknown as Promise<CallToolResult>)
  server.server.setRequestHandler("resources/list", (request, context) =>
    execute("resources/list", request.params ?? {}, context) as unknown as Promise<ListResourcesResult>)
  server.server.setRequestHandler("resources/templates/list", (request, context) =>
    execute("resources/templates/list", request.params ?? {}, context) as unknown as Promise<ListResourceTemplatesResult>)
  server.server.setRequestHandler("resources/read", (request, context) =>
    execute("resources/read", request.params, context) as unknown as Promise<ReadResourceResult>)
  if (input.watchRoot !== undefined && !isAbsolute(input.watchRoot)) {
    reportError(new TypeError("MCP lazy watchRoot must be an absolute source root"))
  } else if (input.watchRoot !== undefined) {
    closeWatcher = watchSourceChanges({
      root: input.watchRoot,
      temporaryRoot: input.temporaryRoot,
      async onChanged() {
        if (closed || !server.isConnected()) return
        await Promise.all([server.server.sendToolListChanged(), server.server.sendResourceListChanged()])
      },
      onError: reportError,
    })
  }
  return server
}
