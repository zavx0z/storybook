import {chatMediaRequest} from "./chat-media"
import {join} from "node:path"
import createChatSessions, {type StorybookChatSession} from "@zavx0z/storybook-chat-session"
import createAcp from "@zavx0z/storybook-tech-acp"
import type {StorybookAppKnowledge} from "@zavx0z/storybook-app-knowledge"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"
import createServerEnvironment from "./environment"
import createTeamTools from "./team"
import createSettings from "@zavx0z/storybook-app-settings"
import {createExecutionOptions, internalCodexPolicy} from "./execution-options"
import type {StorybookAppEnvironment} from "@zavx0z/storybook-app-environment"

type Graph = StorybookPackageGraphRead.Input
type Snapshot = Awaited<ReturnType<StorybookChatSession.Output["read"]>>
type Target = Parameters<StorybookChatSession.Output["read"]>[0]
type HistoryQuery = NonNullable<Parameters<StorybookChatSession.Output["history"]>[1]>

/** Не допускает неограниченное чтение архива через внешний транспорт. */
function historyQuery(value: unknown): HistoryQuery {
  if (value === undefined) return {}
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Нужен диапазон истории")
  const query = value as Record<string, unknown>
  const bounds = {before: [0, Number.MAX_SAFE_INTEGER], after: [0, Number.MAX_SAFE_INTEGER],
    around: [0, Number.MAX_SAFE_INTEGER], projectionRevision: [0, Number.MAX_SAFE_INTEGER], limit: [1, 64], maxBytes: [1024, 131072]} as const
  for (const [key, entry] of Object.entries(query)) {
    if (!Object.hasOwn(bounds, key)) throw new TypeError("Неизвестный параметр диапазона истории")
    const [minimum, maximum] = bounds[key as keyof typeof bounds]
    if (typeof entry !== "number" || !Number.isSafeInteger(entry) || entry < minimum || entry > maximum) {
      throw new TypeError("Недопустимая граница диапазона истории")
    }
  }
  if (["before", "after", "around"].filter(key => Object.hasOwn(query, key)).length > 1) throw new TypeError("Нужен один cursor истории")
  return query as HistoryQuery
}

/** Соединяет адресные беседы с общим окружением предмета и жизненным циклом ACP. */
export function createChatServer(options: Readonly<{
  project: string
  trustedRoots?: readonly string[] | (() => readonly string[])
  projectName(): string
  toolRoot: string
  authorityDirectory?: string
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
  const settings = createSettings({project: options.project, ...(options.authorityDirectory === undefined ? {} : {authorityDirectory: options.authorityDirectory})})
  const executionOptions = createExecutionOptions({...options, connect: options.connect ?? createAcp})
  const subscriptions = new Set<() => void>()
  const chats = createChatSessions({
    directory: subject => join(subject.cwd, "meta/chat"),
    legacyDirectory: join(options.project, "chats"),
    resolve: environment.resolveSubject,
    resolveExecution: async input => settings.resolve({...input, subject: await environment.resolveExecutionSubject(input.subject.address)}),
    saveExecutorSelection: input => settings.updateExecutor(input).then(() => {}),
    saveSessionApproval: input => settings.updateSessionApproval(input),
    async environment(input) {
      const assignment = await environment.acquireSession(input, event => {
        return input.onUpdate(event.phase === "running" ? {
          sessionUpdate: "tool_call", toolCallId: event.id, title: event.name,
          status: "in_progress", rawInput: event.arguments,
        } : {
          sessionUpdate: "tool_call_update", toolCallId: event.id,
          status: event.phase === "progress" ? "in_progress" : event.phase === "success" ? "completed" : "failed",
          rawOutput: event.phase === "progress" ? event.progress : event.phase === "success" ? event.result : {error: event.error},
        })
      }, action => input.authorize(action.id, action.command, action.signal))
      return {
        content: [{type: "text", text: JSON.stringify({environment: assignment.bootstrap})}],
        async execute(command, signal) {
          const response = await assignment.execute(new Request("http://localhost/api/environment", {
            method: "POST",
            headers: {authorization: `Bearer ${assignment.token}`, "content-type": "application/json"},
            body: JSON.stringify(command),
            signal,
          }))
          return [{type: "text", text: await response.text()}]
        },
        dispose() {
          assignment.dispose()
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
        config: internalCodexPolicy,
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
  /** Подписка передаёт только состояние и revision архива, без содержимого истории. */
  const subscribe = async (target: Target, listener: (snapshot: Snapshot) => void): Promise<() => void> => {
    let release = () => {}
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      release()
      subscriptions.delete(close)
    }
    subscriptions.add(close)
    try {
      release = await chats.subscribe(target, value => { if (!closed) listener(value) })
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
      const maximum = path.endsWith("/prompt") || path.endsWith("/enqueue") || path.endsWith("/media-put") ? 16 * 1024 * 1024 : 96_000
      if (text.length > maximum || new TextEncoder().encode(text).byteLength > maximum) {
        return Response.json({error: "Слишком большой запрос чата"}, {status: 413})
      }
      const body = JSON.parse(text) as Record<string, unknown>
      if (body === null || typeof body !== "object" || Array.isArray(body)) return Response.json({error: "Ожидается объект запроса чата"}, {status: 400})
      if (path.endsWith("/execution-settings")) return Response.json(await settings.read(), {headers: {"cache-control": "no-store"}})
      if (path.endsWith("/execution-settings-save")) return Response.json(await settings.update(body.settings as Parameters<typeof settings.update>[0]), {headers: {"cache-control": "no-store"}})
      if (path.endsWith("/execution-options")) {
        const configuration = await settings.read()
        const connection = configuration.connections.find(item => item.id === body.connectionId)
        if (!connection || !connection.enabled) throw new Error("Подключение недоступно или отключено")
        return Response.json(await executionOptions.read(body.model, request.signal), {headers: {"cache-control": "no-store"}})
      }
      if (typeof body?.address !== "string") throw new TypeError("Нужен адрес чата")
      if (Object.hasOwn(body, "executorId") && typeof body.executorId !== "string") throw new TypeError("Нужна identity исполнителя")
      if (body.sessionId !== undefined && (typeof body.sessionId !== "string" || typeof body.executorId !== "string")) throw new TypeError("Сессия должна принадлежать выбранному агенту")
      const target: Target = typeof body.executorId === "string"
        ? {address: body.address, executorId: body.executorId, ...(typeof body.sessionId === "string" ? {sessionId: body.sessionId} : {})} : body.address
      if (body.chatId !== undefined) {
        if (typeof body.chatId !== "string") throw new TypeError("Нужна identity беседы")
        if ((await chats.read(target)).id !== body.chatId) return Response.json({error: "Беседа изменилась"}, {status: 409})
      }
      if (["media-put", "media-read", "media-external"].some(operation => path.endsWith(`/${operation}`))) {
        const snapshot = await chats.read(target)
        const subject = environment.resolveSubject(body.address)
        return await chatMediaRequest({directory: join(subject.cwd, "meta/chat"), sessionId: snapshot.id,
          operation: path.slice(path.lastIndexOf("/") + 1) as "media-put" | "media-read" | "media-external",
          body, signal: request.signal, hasMedia: digest => chats.hasMedia(target, digest)})
      }
      let value: unknown
      if (path.endsWith("/session")) value = await chats.read(target)
      else if (path.endsWith("/executor-preferences")) {
        const snapshot = await chats.read(target)
        value = {...snapshot, execution: await settings.resolve({subject: await environment.resolveExecutionSubject(body.address), executorId: snapshot.executorId, selection: {}})}
      }
      else if (path.endsWith("/sessions")) value = await chats.listSessions(target)
      else if (path.endsWith("/session-create")) value = await chats.createSession(target, body.label as string)
      else if (path.endsWith("/session-rename")) value = await chats.renameSession(target, body.label as string)
      else if (path.endsWith("/sessions-deleted")) value = await chats.listDeletedSessions(target)
      else if (path.endsWith("/session-restore")) value = await chats.restoreSession(target)
      else if (path.endsWith("/session-purge")) {await chats.purgeSession(target); value = {purged: true}}
      else if (path.endsWith("/session-delete")) {
        if (body.sessionId === undefined) throw new TypeError("Нужна точная сессия для удаления")
        await chats.deleteSession(target)
        value = {deleted: true, sessionId: body.sessionId}
      }
      else if (path.endsWith("/history-content") || path.endsWith("/history-detail") || path.endsWith("/history-copy") || path.endsWith("/history-terminal")) {
        if (typeof body.id !== "string" || !body.id || body.id.length > 512) throw new TypeError("Нужен id записи")
        if (path.endsWith("/history-copy")) value = {text: await chats.copyMessage(target, body.id)}
        else if (path.endsWith("/history-terminal")) value = await chats.historyTerminal(target, body.id, body.query as Parameters<typeof chats.historyTerminal>[2])
        else if (path.endsWith("/history-content")) value = await chats.historyContent(target, body.id, body.query as Parameters<typeof chats.historyContent>[2])
        else value = await chats.historyDetail(target, body.id, body.query as Parameters<typeof chats.historyDetail>[2])
      }
      else if (path.endsWith("/history")) value = await chats.history(target, historyQuery(body.query))
      else if (path.endsWith("/history-display")) value = await chats.displayHistory(target, historyQuery(body.query))
      else if (path.endsWith("/history-group") || path.endsWith("/history-group-item")) {
        if (typeof body.groupId !== "string" || !body.groupId || body.groupId.length > 512) throw new TypeError("Нужен id группы истории")
        if (path.endsWith("/history-group-item")) {
          if (typeof body.id !== "string" || !body.id || body.id.length > 512) throw new TypeError("Нужен id события группы")
          value = await chats.groupHistoryItem(target, body.groupId, body.id)
        } else value = await chats.groupHistory(target, body.groupId, historyQuery(body.query))
      }
      else if (path.endsWith("/history-item") || path.endsWith("/history-evidence")) {
        if (typeof body.id !== "string" || !body.id || body.id.length > 512) throw new TypeError("Нужен id записи истории")
        value = path.endsWith("/history-item") ? await chats.historyItem(target, body.id)
          : await chats.historyEvidence(target, body.id, historyQuery(body.query))
      }
      else if (path.endsWith("/list")) value = await chats.list(body.address)
      else if (path.endsWith("/create")) value = await chats.create({address: body.address, label: body.label as string})
      else if (path.endsWith("/prepare")) value = await chats.prepare(target)
      else if (path.endsWith("/execution-configure")) value = await chats.configureExecution(target, body.configuration as Parameters<typeof chats.configureExecution>[1])
      else if (path.endsWith("/configure")) value = await chats.configure(target, body.id as string, body.value as string)
      else if (path.endsWith("/prompt") || path.endsWith("/enqueue")) {
        const content = Object.hasOwn(body, "content") ? body.content : body.text
        value = await (path.endsWith("/enqueue") ? chats.enqueue : chats.prompt)(target, content as Parameters<StorybookChatSession.Output["prompt"]>[1], body.requestId as string)
      } else if (path.endsWith("/cancel")) value = await chats.cancel(target)
      else if (path.endsWith("/stop")) value = await chats.stop(target)
      else if (path.endsWith("/permission")) value = await chats.permission(target, body.id as string, body.optionId as string, body.requestHash as string | undefined)
      else return Response.json({error: "Неизвестное действие чата"}, {status: 404})
      return Response.json(value, {headers: {"cache-control": "no-store"}})
    },
    async dispose() {
      for (const close of subscriptions) close()
      await executionOptions.dispose()
      environment.dispose()
      await chats.dispose()
    },
  }
}
