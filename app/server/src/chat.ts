import {join} from "node:path"
import createChatSessions, {type StorybookChatSession} from "@zavx0z/storybook-chat-session"
import createAcp from "@zavx0z/storybook-tech-acp"
import type {StorybookAppKnowledge} from "@zavx0z/storybook-app-knowledge"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"
import createServerEnvironment from "./environment"
import createTeamTools from "./team"
import type {StorybookAppEnvironment} from "@zavx0z/storybook-app-environment"

type Graph = StorybookPackageGraphRead.Input
type Snapshot = Awaited<ReturnType<StorybookChatSession.Output["read"]>>
type Target = Parameters<StorybookChatSession.Output["read"]>[0]

/** Соединяет адресные беседы с общим окружением предмета и жизненным циклом ACP. */
export function createChatServer(options: Readonly<{
  project: string
  projectName(): string
  toolRoot: string
  graph(): Graph
  entries(): StorybookAppKnowledge.Input[1]["entries"]
  connect?: typeof createAcp
  recordRequest?: (entry: Record<string, unknown>) => void
  extensions?: StorybookAppEnvironment.Input["extensions"]
}>) {
  const environment = createServerEnvironment({...options,
    extensions: async input => [
      ...createTeamTools({executorId: input.executorId, address: input.subject.address,
        inspectExecutors: input.inspectExecutors, graph: options.graph, chats: () => chats}),
      ...await options.extensions?.(input) ?? [],
    ],
  })
  const subscriptions = new Set<() => void>()
  const chats = createChatSessions({
    directory: subject => join(subject.cwd, "meta/chat"),
    legacyDirectory: join(options.project, "chats"),
    resolve: environment.resolveSubject,
    async environment(input) {
      const assignment = await environment.assignExecutor({executorId: input.executorId, executorLabel: input.executorLabel, address: input.address})
      const release = environment.subscribe(input.executorId, event => {
        input.onUpdate(event.phase === "running" ? {
          sessionUpdate: "tool_call", toolCallId: event.id, title: event.name,
          status: "in_progress", rawInput: event.arguments,
        } : {
          sessionUpdate: "tool_call_update", toolCallId: event.id,
          status: event.phase === "progress" ? "in_progress" : event.phase === "success" ? "completed" : "failed",
          rawOutput: event.phase === "progress" ? event.progress : event.phase === "success" ? event.result : {error: event.error},
        })
      })
      return {
        content: [{type: "text", text: JSON.stringify({environment: assignment.bootstrap})}],
        async execute(command, signal) {
          const response = await environment.handle(new Request("http://localhost/api/environment", {
            method: "POST",
            headers: {authorization: `Bearer ${assignment.token}`, "content-type": "application/json"},
            body: JSON.stringify(command),
            signal,
          }))
          return [{type: "text", text: await response.text()}]
        },
        dispose() {
          release()
          environment.revokeExecutor(input.executorId)
        },
      }
    },
    async connect(input) {
      // Назначение принадлежит окружению: освобождение или отказ ACP его не отзывает.
      return (options.connect ?? createAcp)({
        cwd: input.subject.cwd,
        installation: options.toolRoot,
        mode: "read-only",
        exclusiveMcp: true,
        // Штатные ограничения отдельного Codex; это ещё не общий provider no-tools контракт.
        config: {
          "features.shell_tool": false,
          "features.unified_exec": false,
          "features.view_image": false,
          "features.multi_agent": false,
          "features.hooks": false,
          "skills.include_instructions": false,
          project_doc_max_bytes: 0,
          web_search: "disabled",
        },
        signal: input.signal,
        ...(input.previousSessionId === undefined ? {} : {previousSessionId: input.previousSessionId}),
        ...(input.preferResume === undefined ? {} : {preferResume: input.preferResume}),
        ...(input.onProgress === undefined ? {} : {onProgress: input.onProgress}),
        ...(input.onReplay === undefined ? {} : {onReplay: input.onReplay}),
        onUpdate: input.onUpdate,
        onPermission: input.onPermission,
        mcpServers: [],
      })
    },
  })
  /** Один подписчик получает свежий снимок, последующие изменения объединяются за 50 мс. */
  const subscribe = async (target: Target, listener: (snapshot: Snapshot) => void): Promise<() => void> => {
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
      release = await chats.subscribe(target, value => {
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
    environment,
    subscribe,
    async request(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname
      if (path.endsWith("/events") && request.method === "GET") {
        return Response.json({error: "События чата доступны через WebSocket /api/events"}, {status: 410})
      }
      if (request.method !== "POST") return Response.json({error: "Ожидается POST"}, {status: 405})
      const text = await request.text()
      const maximum = path.endsWith("/prompt") ? 16 * 1024 * 1024 : 96_000
      if (text.length > maximum) return Response.json({error: "Слишком большой запрос чата"}, {status: 413})
      const body = JSON.parse(text) as Record<string, unknown>
      if (body === null || typeof body !== "object" || Array.isArray(body)) return Response.json({error: "Ожидается объект запроса чата"}, {status: 400})
      if ((!Object.hasOwn(body, "content") && text.length > 96_000) ||
        new TextEncoder().encode(text).byteLength > 16 * 1024 * 1024) {
        return Response.json({error: "Слишком большой запрос чата"}, {status: 413})
      }
      if (typeof body?.address !== "string") throw new TypeError("Нужен адрес чата")
      if (Object.hasOwn(body, "executorId") && typeof body.executorId !== "string") throw new TypeError("Нужна identity исполнителя")
      const target: Target = typeof body.executorId === "string" ? {address: body.address, executorId: body.executorId} : body.address
      let value: Snapshot | readonly Snapshot[]
      if (path.endsWith("/session")) value = await chats.read(target)
      else if (path.endsWith("/list")) value = await chats.list(body.address)
      else if (path.endsWith("/create")) value = await chats.create({address: body.address, label: body.label as string})
      else if (path.endsWith("/prepare")) value = await chats.prepare(target)
      else if (path.endsWith("/configure")) value = await chats.configure(target, body.id as string, body.value as string)
      else if (path.endsWith("/prompt")) {
        const content = Object.hasOwn(body, "content") ? body.content : body.text
        value = await chats.prompt(target, content as Parameters<StorybookChatSession.Output["prompt"]>[1], body.requestId as string)
      } else if (path.endsWith("/cancel")) value = await chats.cancel(target)
      else if (path.endsWith("/permission")) value = await chats.permission(target, body.id as string, body.optionId as string)
      else return Response.json({error: "Неизвестное действие чата"}, {status: 404})
      return Response.json(value, {headers: {"cache-control": "no-store"}})
    },
    async dispose() {
      for (const close of subscriptions) close()
      environment.dispose()
      await chats.dispose()
    },
  }
}
