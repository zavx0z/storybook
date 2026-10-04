import {randomBytes} from "node:crypto"
import {dirname, join} from "node:path"
import createChatSessions, {type StorybookChatSession} from "@storybook-chat/session"
import createAcp from "@storybook-tech/acp"
import storybookRest, {type StorybookAppMcpRest} from "@storybook-app-mcp/rest"
import type {StorybookPackageGraphRead} from "@storybook-package-graph/read"

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
}>) {
  const grants = new Map<string, string>()
  const subscriptions = new Set<() => void>()
  const resolve = (address: string) => {
    if (address === "/") return {address, label: options.projectName(), cwd: options.project}
    if (typeof address !== "string" || !address.startsWith("/") || /[?#]/u.test(address)) throw new TypeError("Нужен канонический адрес предмета")
    const node = options.graph().nodes.find(node => node.urlPath === address)
    if (node === undefined || node.kind === "unavailable") throw new Error("Предмет чата отсутствует в текущем Project")
    return {address: node.urlPath, label: node.label, cwd: node.kind === "package" || node.kind === "entry" ? dirname(node.source.path) : node.source.path}
  }
  const chats = createChatSessions({
    directory: join(options.project, "chats"),
    resolve,
    async connect(input) {
      const key = randomBytes(32).toString("hex")
      grants.set(key, input.subject.address)
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
  const scopedMcp = async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "POST") return Response.json({error: "Ожидается GET или POST"}, {status: 405})
    const key = request.headers.get("authorization")?.replace(/^Bearer /u, "")
    const address = key === undefined ? undefined : grants.get(key)
    if (address === undefined) return Response.json({error: "Подключение агента недоступно"}, {status: 401})
    const subject = resolve(address)
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
      "@storybook-package/reader", "@storybook/domain", "@storybook/cluster", "@storybook/component",
      "@storybook/container", "@storybook/contracts", "@storybook/typedoc",
    ].includes(node.packageId ?? ""))
    for (const rule of rules) visit(rule.id)
    const allowed = entries.filter(entry => permitted.has(entry.path))
    let input: unknown = {}
    if (request.method === "POST") {
      const body = await request.clone().text()
      if (body.length > 16_384) return Response.json({error: "Слишком большой запрос"}, {status: 413})
      try { input = body.length === 0 ? {} : JSON.parse(body) } catch { return Response.json({error: "Ожидается JSON"}, {status: 400}) }
    }
    if (input === null || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "path")) {
      return Response.json({error: "Ожидается только необязательный path"}, {status: 400})
    }
    const selectedPath = "path" in input ? input.path : rootPath
    if (typeof selectedPath !== "string" || !permitted.has(selectedPath)) return Response.json({error: "Адрес вне области этого агента"}, {status: 403})
    const response = await storybookRest(new Request(request.url, {
      method: "POST", headers: {"content-type": "application/json"},
      body: JSON.stringify({path: selectedPath}), signal: request.signal,
    }), {projectName: options.projectName(), entries: allowed})
    if (!response.ok || "path" in input) return response
    const content = await response.json() as Record<string, unknown>
    return Response.json({...content,
      scope: {path: rootPath, label: subject.label},
      rules: rules.map(node => ({path: node.urlPath.slice(1), label: node.label})),
    })
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
