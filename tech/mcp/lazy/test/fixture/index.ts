import createLazyMcpServer from "@mcp/lazy"
import type {CallToolResult} from "@modelcontextprotocol/server"
import {Client, InMemoryTransport} from "@modelcontextprotocol/client"
import {mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"

export const captureUri = "fixture://captures/frame"
export const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII="
export const captureResult = {
  content: [
    {type: "text", text: "Готовый снимок"},
    {type: "image", mimeType: "image/png", data: png, annotations: {audience: ["user"]}},
    {type: "resource_link", uri: captureUri, name: "frame.png", description: "Полный PNG", mimeType: "image/png"},
  ],
  structuredContent: {captureId: "frame", resourceUri: captureUri, details: {width: 1, height: 1, retained: true}},
  _meta: {fixture: "complete-response", nested: {unchanged: true}},
} satisfies CallToolResult

/** Подготавливает только доверенный SDK factory и его реальные transitive исходники. */
export function createLazyFixture() {
  const root = mkdtempSync(join(tmpdir(), "native-lazy-mcp-"))
  const temporaryRoot = mkdtempSync(join(tmpdir(), "native-lazy-jobs-"))
  const repository = resolve(import.meta.dir, "../../../../..")
  symlinkSync(join(repository, "node_modules"), join(root, "node_modules"))
  writeFileSync(join(root, "package.json"), JSON.stringify({name: "@fixture/lazy-native", type: "module"}))
  writeFileSync(join(root, "payload.ts"), [
    'import type {CallToolResult} from "@modelcontextprotocol/server"',
    `export const png = ${JSON.stringify(png)}`,
    `export const captureResult = ${JSON.stringify(captureResult)} satisfies CallToolResult`,
  ].join("\n"))
  const updateHandler = (version: "v1" | "v2") => writeFileSync(join(root, "handler.ts"), [
    `export const version = ${JSON.stringify(version)}`,
    "export default function reply(input: Record<string, unknown>) {",
    "  const value = input.text ?? input.value",
    '  return {content: [{type: "text" as const, text: `${version}:${value}`}], structuredContent: {version, value}}',
    "}",
  ].join("\n"))
  const updateSchema = (version: "v1" | "v2") => writeFileSync(join(root, "schema.ts"), [
    'import {z} from "zod"',
    `export default z.strictObject({${version === "v1" ? "text" : "value"}: z.string()})`,
  ].join("\n"))
  updateHandler("v1")
  updateSchema("v1")
  const serverModule = join(root, "server.ts")
  writeFileSync(serverModule, `
import {McpServer, ResourceTemplate} from "@modelcontextprotocol/server"
import {writeFileSync} from "node:fs"
import {join} from "node:path"
import {z} from "zod"
import reply, {version} from "./handler.ts"
import schema from "./schema.ts"
import {png, captureResult} from "./payload.ts"

const root = ${JSON.stringify(root)}

export default function factory() {
  const server = new McpServer({name: "transient-fixture", version: "1"})
  server.registerTool("echo", {description: "Ответ из transitive handler", inputSchema: schema}, input => reply(input))
  server.registerTool("capture", {description: "Полный бинарный ответ", inputSchema: z.strictObject({})}, async () => {
    process.once("exit", () => writeFileSync(join(root, "capture.exited"), "exited"))
    return captureResult
  })
  server.registerTool("hold", {
    description: "Отменяемая независимая работа",
    inputSchema: z.strictObject({id: z.string().regex(/^[a-z]+$/u), delayMs: z.number().int().min(1).max(3000)}),
  }, async ({id, delayMs}, context) => {
    const signal = context.mcpReq.signal
    const token = context.mcpReq._meta?.progressToken
    const notify = async (progress: number, message: string) => {
      if (token !== undefined) await context.mcpReq.notify({
        method: "notifications/progress", params: {progressToken: token, progress, total: 2, message},
      })
    }
    writeFileSync(join(root, id + ".started"), "started")
    try {
      signal.throwIfAborted()
      await notify(1, id + ":started")
      await new Promise<void>((resolve, reject) => {
        const aborted = () => {
          clearTimeout(timer)
          signal.removeEventListener("abort", aborted)
          reject(signal.reason ?? new DOMException("Отменено", "AbortError"))
        }
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", aborted)
          resolve()
        }, delayMs)
        signal.addEventListener("abort", aborted, {once: true})
        if (signal.aborted) aborted()
      })
      await notify(2, id + ":complete")
      return {content: [{type: "text" as const, text: "done:" + id}], structuredContent: {id, done: true}}
    } finally {
      writeFileSync(join(root, id + ".cleanup"), signal.aborted ? "aborted" : "completed")
    }
  })
  server.registerResource("state", "fixture://state", {mimeType: "text/plain", description: "Текущая версия"},
    async uri => ({contents: [{uri: uri.href, mimeType: "text/plain", text: version + ":state"}]}))
  server.registerResource("capture-png", ${JSON.stringify(captureUri)}, {mimeType: "image/png", description: "Сохранённый PNG"},
    async uri => ({contents: [{uri: uri.href, mimeType: "image/png", blob: png}]}))
  server.registerResource("item", new ResourceTemplate("fixture://items/{id}", {
    list: async () => ({resources: [{name: "example", uri: "fixture://items/example", mimeType: "text/plain"}]}),
  }), {description: "Элемент по адресу", mimeType: "text/plain"},
    async (uri, variables) => ({contents: [{uri: uri.href, mimeType: "text/plain", text: version + ":" + variables.id}]}))
  return server
}
`)
  return {
    root,
    serverModule,
    options: {serverModule, cwd: root, temporaryRoot, watchRoot: root, name: "stable-lazy-fixture", version: "1", timeoutMs: 15_000},
    updateHandler,
    updateSchema,
    dispose() {
      rmSync(root, {recursive: true, force: true})
      rmSync(temporaryRoot, {recursive: true, force: true})
    },
  }
}

/** Один настоящий SDK Client и transport; журнал наблюдает только публичный JSON-RPC wire. */
export async function connectLazyFixture(fixture: ReturnType<typeof createLazyFixture>) {
  const server = await createLazyMcpServer(fixture.options)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const requests: Parameters<typeof clientTransport.send>[0][] = []
  const notifications: Parameters<typeof serverTransport.send>[0][] = []
  const sendRequest = clientTransport.send.bind(clientTransport)
  const sendResponse = serverTransport.send.bind(serverTransport)
  clientTransport.send = async (...args) => {
    requests.push(args[0])
    await sendRequest(...args)
  }
  serverTransport.send = async (...args) => {
    notifications.push(args[0])
    await sendResponse(...args)
  }
  const client = new Client({name: "native-lazy-client", version: "1"}, {
    versionNegotiation: {mode: "auto", probe: {timeoutMs: 1000}},
  })
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  } catch (error) {
    await Promise.allSettled([client.close(), server.close()])
    fixture.dispose()
    throw error
  }
  return {
    client,
    server,
    requests,
    notifications,
    async close() {
      await client.close()
      await server.close()
    },
  }
}

/** Bounded ожидание наблюдаемого эффекта, а не задержка для удачного исхода теста. */
export async function waitFor(condition: () => boolean, message: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(message)
    await Bun.sleep(20)
  }
}
