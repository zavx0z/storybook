import {randomBytes, randomUUID} from "node:crypto"
import mcpResponse from "@zavx0z/storybook-app-mcp-response"
import createEntityTools from "@zavx0z/storybook-app-mcp-tools"
import ToolError from "@zavx0z/ai-tech-failure"
import {dirname, join} from "node:path"
import createChatSessions, {type StorybookChatSession} from "@zavx0z/storybook-chat-session"
import createAcp from "@zavx0z/storybook-tech-acp"
import storybookRest, {type StorybookAppMcpRest} from "@zavx0z/storybook-app-mcp-rest"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"

type Graph = StorybookPackageGraphRead.Input
type Snapshot = Awaited<ReturnType<StorybookChatSession.Output["read"]>>

/** Соединяет адресные беседы с каталогом, Codex ACP и собственным MCP-входом приложения. */
export function createChatServer(options: Readonly<{
  project: string
  projectName(): string
  toolRoot: string
  origin(): string
  graph(): Graph
  entries(): StorybookAppMcpRest.Input[1]["entries"]
  connect?: typeof createAcp
  recordRequest?: (entry: Record<string, unknown>) => void
}>) {
  const grants = new Map<string, {address: string, agentId: string, tools: ReturnType<typeof createEntityTools>}>()
  const subscriptions = new Set<() => void>()
  const resolve = (address: string) => {
    if (address === "/") return {address, label: options.projectName(), cwd: options.project}
    if (typeof address !== "string" || !address.startsWith("/") || /[?#]/u.test(address)) throw new TypeError("Нужен канонический адрес предмета")
    const node = options.graph().nodes.find(node => node.urlPath === address)
    if (node === undefined || node.kind === "unavailable") throw new Error("Предмет чата отсутствует в текущем Project")
    return {address: node.urlPath, label: node.label, cwd: node.kind === "package" || node.kind === "entry" ? dirname(node.source.path) : node.source.path}
  }
  const chats = createChatSessions({
    directory: subject => join(subject.cwd, "meta/chat"),
    legacyDirectory: join(options.project, "chats"),
    resolve,
    async connect(input) {
      const key = randomBytes(32).toString("hex")
      const selected = options.entries().find(entry => entry.path === input.subject.address.slice(1))
      const verification = await selected?.readType?.()
      const type = input.subject.address === "/" ? "Project" : verification?.status === "confirmed" ? verification.type : undefined
      const tools = createEntityTools({directory: input.subject.cwd, ...(type === undefined ? {} : {type})})
      grants.set(key, {address: input.subject.address, agentId: randomUUID(), tools})
      try {
        const connection = await (options.connect ?? createAcp)({
          cwd: input.subject.cwd,
          installation: options.toolRoot,
          mode: "workspace-write",
          exclusiveMcp: true,
          signal: input.signal,
          ...(input.previousSessionId === undefined ? {} : {previousSessionId: input.previousSessionId}),
          ...(input.onProgress === undefined ? {} : {onProgress: input.onProgress}),
          onUpdate: input.onUpdate,
          onPermission: input.onPermission,
          mcpServers: [{
            name: "storybook",
            command: process.execPath,
            args: [join(options.toolRoot, "app/src/chat-mcp.ts")],
            env: [
              {name: "STORYBOOK_CHAT_ORIGIN", value: options.origin()},
              {name: "STORYBOOK_CHAT_KEY", value: key},
            ],
          }],
        })
        return {...connection, async dispose() {
          grants.delete(key)
          await connection.dispose()
        }}
      } catch (error) {
        grants.delete(key)
        throw error
      }
    },
  })
  const readScopedMcp = async (request: Request, address: string): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "POST") return Response.json({error: "Ожидается GET или POST"}, {status: 405})
    resolve(address)
    const entries = options.entries()
    if (address === "/") return storybookRest(request, {projectName: options.projectName(), entries})
    const rootPath = address.slice(1)
    const graph = options.graph()
    const root = graph.nodes.find(node => node.urlPath === address)!
    const permitted = new Set<string>()
    const byId = new Map(graph.nodes.map(node => [node.id, node]))
    const visit = (id: string) => {
      const node = byId.get(id)
      if (node === undefined || permitted.has(node.urlPath.slice(1))) return
      permitted.add(node.urlPath.slice(1))
      for (const child of node.childIds) visit(child)
    }
    visit(root.id)
    const rules = graph.nodes.filter(node => node.kind === "package" && [
      "@zavx0z/storybook-package-reader", "@zavx0z/storybook-domain", "@zavx0z/storybook-cluster", "@zavx0z/storybook-component",
      "@zavx0z/storybook-container", "@zavx0z/storybook-contracts", "@zavx0z/storybook-typedoc",
    ].includes(node.packageId ?? ""))
    for (const rule of rules) visit(rule.id)
    const allowed = entries.filter(entry => permitted.has(entry.path))
    return storybookRest(request, {
      projectName: options.projectName(),
      entries: allowed,
      root: {path: rootPath, references: rules.map(node => node.urlPath.slice(1))},
    })
  }
  /** Источник записи задаёт выданное подключение, независимо от path запроса и результата. */
  const scopedMcp = async (request: Request): Promise<Response> => {
    const key = request.headers.get("authorization")?.replace(/^Bearer /u, "")
    const grant = key === undefined ? undefined : grants.get(key)
    if (grant === undefined) return Response.json({error: "Подключение агента недоступно"}, {status: 401})
    const startedAt = Date.now()
    const text = request.method === "POST" ? await request.clone().text() : "{}"
    let input: unknown = text.length > 16_384 ? {error: "Превышен размер запроса MCP", length: text.length} : text
    if (text.length <= 16_384) try { input = JSON.parse(text || "{}") } catch {}
    const record = {id: randomUUID(), tool: "storybook", startedAt, address: grant.address, agentId: grant.agentId,
      input: JSON.stringify(mcpResponse.sanitizeValue(input), null, 2) ?? ""}
    const write = (value: Record<string, unknown>) => {
      try { options.recordRequest?.(value) } catch { /* Журнал не отменяет вызов агента. */ }
    }
    write({...record, status: "running", durationMs: null, result: ""})
    try {
      const response = await readScopedMcp(request, grant.address)
      const text = await response.clone().text()
      let value: unknown = text
      try { value = JSON.parse(text) } catch {}
      write({...record, status: response.ok ? "success" : "failed", durationMs: Date.now() - startedAt,
        result: JSON.stringify(mcpResponse.sanitizeValue(value), null, 2)})
      return response
    } catch (error) {
      write({...record, status: "failed", durationMs: Date.now() - startedAt,
        result: JSON.stringify({error: mcpResponse.sanitizeString(error instanceof Error ? error.message : String(error))})})
      throw error
    }
  }
  /** Каталог и вызовы инструментов используют тот же grant и неизменную область агента. */
  const scopedTools = async (request: Request, command?: unknown): Promise<Response> => {
    const key = request.headers.get("authorization")?.replace(/^Bearer /u, "")
    const grant = key === undefined ? undefined : grants.get(key)
    if (grant === undefined) return Response.json({error: {code: "UNAUTHORIZED", message: "Подключение агента недоступно"}}, {status: 401})
    if (request.method === "GET") return Response.json({tools: grant.tools.list()}, {headers: {"cache-control": "no-store"}})
    if (request.method !== "POST") return Response.json({error: {code: "METHOD_NOT_ALLOWED", message: "Ожидается GET или POST"}}, {status: 405})
    const startedAt = Date.now()
    const name = command !== null && typeof command === "object" && "name" in command && typeof command.name === "string" ? command.name : "unknown"
    const entry = {id: randomUUID(), tool: name.slice(0, 128), startedAt, address: grant.address, agentId: grant.agentId,
      input: JSON.stringify(mcpResponse.sanitizeValue(command)) ?? ""}
    const write = (value: Record<string, unknown>) => {
      try { options.recordRequest?.(value) } catch { /* Журнал не отменяет инструмент. */ }
    }
    write({...entry, status: "running", durationMs: null, result: ""})
    try {
      const result = await grant.tools.call(command, request.signal)
      write({...entry, status: "success", durationMs: Date.now() - startedAt, result: JSON.stringify(mcpResponse.sanitizeValue(result))})
      // Содержимое файлов является результатом инструмента: его нельзя очищать как служебную диагностику.
      return Response.json({result})
    } catch (cause) {
      const error = ToolError.from(cause)
      const value = {code: error.code, message: error.message, ...(error.details === undefined ? {} : {details: error.details})}
      write({...entry, status: "failed", durationMs: Date.now() - startedAt, result: JSON.stringify(mcpResponse.sanitizeValue({error: value}))})
      return Response.json({error: value}, {status: error.status})
    }
  }
  /** Один подписчик получает свежий снимок, последующие изменения объединяются за 50 мс. */
  const subscribe = async (address: string, listener: (snapshot: Snapshot) => void): Promise<() => void> => {
    let release = () => {}
    let closed = false
    let latest: Snapshot | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const emit = () => {
      if (closed || latest === null) return
      const value = latest
      latest = null
      listener(value)
    }
    const close = () => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      release()
      subscriptions.delete(close)
    }
    subscriptions.add(close)
    try {
      release = await chats.subscribe(address, value => {
        if (closed) return
        latest = value
        if (timer === undefined) {
          emit()
          timer = setTimeout(() => { timer = undefined; emit() }, 50)
        }
      })
      if (closed) release()
      return close
    } catch (error) { close(); throw error }
  }
  return {
    chats,
    scopedMcp,
    scopedTools,
    subscribe,
    async request(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname
      if (path.endsWith("/events") && request.method === "GET") {
        return Response.json({error: "События чата доступны через WebSocket /api/events"}, {status: 410})
      }
      if (request.method !== "POST") return Response.json({error: "Ожидается POST"}, {status: 405})
      const text = await request.text()
      if (text.length > 96_000) return Response.json({error: "Слишком большой запрос чата"}, {status: 413})
      const body = JSON.parse(text) as Record<string, unknown>
      if (typeof body?.address !== "string") throw new TypeError("Нужен адрес чата")
      let value: Snapshot
      if (path.endsWith("/session")) value = await chats.read(body.address)
      else if (path.endsWith("/prepare")) value = await chats.prepare(body.address)
      else if (path.endsWith("/configure")) value = await chats.configure(body.address, body.id as string, body.value as string)
      else if (path.endsWith("/prompt")) {
        value = await chats.prompt(body.address, body.text as string, body.requestId as string)
      } else if (path.endsWith("/cancel")) value = await chats.cancel(body.address)
      else if (path.endsWith("/permission")) value = await chats.permission(body.address, body.id as string, body.optionId as string)
      else return Response.json({error: "Неизвестное действие чата"}, {status: 404})
      return Response.json(value, {headers: {"cache-control": "no-store"}})
    },
    async dispose() {
      for (const close of subscriptions) close()
      grants.clear()
      await chats.dispose()
    },
  }
}
