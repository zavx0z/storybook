import {readFileSync, writeFileSync} from "node:fs"
import {format} from "node:util"
import {pathToFileURL} from "node:url"
import type {McpServer} from "@modelcontextprotocol/server"
import type {Client, ClientRequest, Progress} from "@modelcontextprotocol/client"
import {
  MCP_IDLE_TIMEOUT_MS,
  MCP_CANCELLATION_DRAIN_MS,
  MCP_RESULT_MAX_BYTES,
  isLazyMethod,
  isRecord,
  requestParams,
  type LazyJob,
  type LazyOutcome,
} from "./protocol"

const lifetime = new AbortController()
let cancelledAt: number | null = null
const cancel = (): void => {
  cancelledAt ??= Date.now()
  lifetime.abort(new DOMException("MCP request was cancelled", "AbortError"))
}
process.on("SIGTERM", cancel)
process.on("SIGINT", cancel)

// stdout принадлежит только ready/phase протоколу; сообщения загружаемой factory идут в stderr.
for (const method of ["log", "info", "debug", "warn", "error", "trace", "dir", "table"] as const) {
  console[method] = (...values: unknown[]) => { process.stderr.write(format(...values) + "\n") }
}
const emit = (value: unknown): Promise<void> => new Promise((resolve, reject) => {
  process.stdout.write(JSON.stringify(value) + "\n", error => error ? reject(error) : resolve())
})
const [jobPath, resultPath, workerId] = process.argv.slice(2)
if (!jobPath || !resultPath || !workerId) {
  process.stderr.write("MCP lazy worker argv is incomplete\n")
  process.exit(1)
}

let client: Client | null = null
let server: McpServer | null = null
let outcome: LazyOutcome = {ok: false, error: {code: -32603, message: "MCP request execution failed"}}
let events = Promise.resolve()
try {
  const job = JSON.parse(readFileSync(jobPath, "utf8")) as LazyJob
  if (!isRecord(job) || typeof job.serverModule !== "string" || !isLazyMethod(job.method) || !isRecord(job.params) || typeof job.progress !== "boolean") {
    throw new Error("MCP lazy worker job is invalid")
  }
  await emit({kind: "ready", workerId, pid: process.pid})
  lifetime.signal.throwIfAborted()
  const {Client, InMemoryTransport, ProtocolError, specTypeSchemas} = await import("@modelcontextprotocol/client")
  const namespace = await import(pathToFileURL(job.serverModule).href) as {default?: unknown}
  if (typeof namespace.default !== "function") throw new Error("MCP server module has no default factory")
  lifetime.signal.throwIfAborted()
  server = await (namespace.default as () => McpServer | Promise<McpServer>)()
  lifetime.signal.throwIfAborted()
  client = new Client({name: "mcp-lazy-worker", version: "1"})
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport, {signal: lifetime.signal, timeout: MCP_IDLE_TIMEOUT_MS}),
  ])
  const schemas = {
    "tools/list": specTypeSchemas.ListToolsResult,
    "tools/call": specTypeSchemas.CallToolResult,
    "resources/list": specTypeSchemas.ListResourcesResult,
    "resources/templates/list": specTypeSchemas.ListResourceTemplatesResult,
    "resources/read": specTypeSchemas.ReadResourceResult,
  }
  try {
    const result = await client.request({method: job.method, params: requestParams(job.params)} as ClientRequest, schemas[job.method], {
      signal: lifetime.signal,
      timeout: MCP_IDLE_TIMEOUT_MS,
      resetTimeoutOnProgress: true,
      ...(job.progress ? {onprogress(value: Progress) {
        const {progressToken: _token, ...progress} = value as unknown as Record<string, unknown>
        events = events.then(() => emit({kind: "phase", event: progress})).catch(error => {
          lifetime.abort(error)
        })
      }} : {}),
    })
    if (!isRecord(result)) throw new Error("MCP result is not an object")
    outcome = {ok: true, result}
  } catch (error) {
    if (error instanceof ProtocolError) {
      outcome = {ok: false, error: {code: error.code, message: error.message, ...(error.data === undefined ? {} : {data: error.data})}}
    } else throw error
  }
} catch (error) {
  console.error("MCP lazy worker failed", error)
} finally {
  // Factory.close освобождает принадлежащую ей работу; native close отдельно отменяет связь.
  await Promise.allSettled([client?.close(), server?.close()]).then(results => {
    for (const result of results) if (result.status === "rejected") {
      console.error("MCP lazy cleanup failed", result.reason)
      if (outcome.ok) outcome = {ok: false, error: {code: -32603, message: "MCP request cleanup failed"}}
    }
  })
  await events
  // Native SDK close не ждёт finally generic handler; оставляем bounded drain до hard kill родителя.
  if (cancelledAt !== null) {
    const remaining = MCP_CANCELLATION_DRAIN_MS - (Date.now() - cancelledAt)
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining))
  }
  try {
    const json = JSON.stringify(outcome)
    if (Buffer.byteLength(json) > MCP_RESULT_MAX_BYTES) throw new Error("MCP lazy result exceeds limit")
    writeFileSync(resultPath, json, {mode: 0o600, flag: "wx"})
  } catch (error) {
    console.error("MCP lazy result write failed", error)
    process.exit(1)
  }
  process.removeListener("SIGTERM", cancel)
  process.removeListener("SIGINT", cancel)
}
// Detached daemon может оставить stderr reader Promise; это не продлевает время жизни worker.
process.exit(0)
