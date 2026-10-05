import createEnvironment, {type StorybookAppEnvironment} from "@zavx0z/storybook-app-environment"
import storybookRest, {type StorybookAppMcpRest} from "@zavx0z/storybook-app-mcp-rest"
import mcpResponse from "@zavx0z/storybook-app-mcp-response"
import state from "@zavx0z/storybook-app-server-state"
import ToolError from "@zavx0z/ai-tech-failure"
import {dirname} from "node:path"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"
import createKnowledgeNotes, {knowledgePath} from "./knowledge-notes"
import {streamAppOperation} from "./app-stream"
import createInstructionsReader from "./instructions"

type Assignment = Awaited<ReturnType<StorybookAppEnvironment.Output["assign"]>>
type Authority = Parameters<typeof state.assertExternalStorybookControlRequest>[1]
type CallEvent = Parameters<NonNullable<StorybookAppEnvironment.Input["onCall"]>>[0]
type Options = Readonly<{
  project: string
  toolRoot?: string
  projectName(): string
  graph(): StorybookPackageGraphRead.Input
  entries(): StorybookAppMcpRest.Input[1]["entries"]
  recordRequest?: (entry: Record<string, unknown>) => void
  extensions?: StorybookAppEnvironment.Input["extensions"]
}>

/**
Соединяет назначения окружения с теми же предметами и знаниями, что использует чат.
Хост сохраняет bearer между подключениями модели; исполнение и отзыв принадлежат
App Environment. Нормативные ссылки выбираются здесь один раз для всех адаптеров.
Меню root раскрывает собственные meta/notes и явные ссылки на нормативные
Markdown-источники установленного Storybook. Выбор документа читает его целиком
через существующие AI-инструменты, сохраняя отдельные файловые права назначения.
*/
export default function createServerEnvironment(options: Options) {
  const notes = createKnowledgeNotes(options.toolRoot)
  const readInstructions = createInstructionsReader(options.project)
  const instructionsEntry = {path: "./instructions", description: "Действующие агентские правила по цепочке Project и назначенного предмета"}
  const observers = new Map<string, Set<(event: CallEvent) => void>>()
  const resolveSubject = (address: string) => {
    if (address === "/") return {address, label: options.projectName(), cwd: options.project}
    if (typeof address !== "string" || !address.startsWith("/") || address.startsWith("//") || /[?#]/u.test(address)) {
      throw new TypeError("Нужен канонический адрес предмета")
    }
    const node = options.graph().nodes.find(node => node.urlPath === address)
    if (node === undefined || node.kind === "unavailable") throw new Error("Предмет отсутствует в текущем Project")
    return {address: node.urlPath, label: node.label, cwd: node.kind === "package" || node.kind === "entry" ? dirname(node.source.path) : node.source.path}
  }
  const readCatalogSubject = async (request: Request, address: string): Promise<Response> => {
    const entries = options.entries()
    if (address === "/") return storybookRest(request, {projectName: options.projectName(), entries})
    const graph = options.graph()
    const root = graph.nodes.find(node => node.urlPath === address)
    if (root === undefined || root.kind === "unavailable") throw new Error("Предмет отсутствует в текущем Project")
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
    return storybookRest(request, {
      projectName: options.projectName(),
      entries: entries.filter(entry => permitted.has(entry.path)),
      root: {path: address.slice(1), references: rules.map(node => node.urlPath.slice(1))},
    })
  }
  const readSubject = async (request: Request, address: string): Promise<Response> => {
    const subject = resolveSubject(address)
    const path = await knowledgePath(request)
    if (path === instructionsEntry.path) return Response.json({
      path, description: instructionsEntry.description, instructions: readInstructions(subject.cwd), children: [],
    })
    if (path !== null) {
      const document = notes.read(subject.cwd, path)
      if (document !== undefined) return Response.json(document)
    }
    const response = await readCatalogSubject(request, address)
    if (!response.ok || path !== undefined && path !== ".") return response
    const value = await response.json() as {children: {path: string, description: string}[]}
    return Response.json({...value, children: [...value.children, ...notes.menus, instructionsEntry]}, {status: response.status, headers: response.headers})
  }
  const environment = createEnvironment({
    stream: streamAppOperation,
    instructions: input => readInstructions(input.subject.directory),
    async resolve(address) {
      const subject = resolveSubject(address)
      notes.bind(subject.cwd)
      const selected = options.entries().find(entry => entry.path === address.slice(1))
      const verification = address === "/" ? undefined : await selected?.readType?.()
      const type = address === "/" ? "Project" : verification?.status === "confirmed" ? verification.type : undefined
      return {address: subject.address, label: subject.label, directory: subject.cwd, ...(type === undefined ? {} : {type})}
    },
    ...(options.extensions === undefined ? {} : {extensions: options.extensions}),
    readKnowledge({address, path, signal}) {
      return readSubject(new Request("http://localhost/knowledge", {
        method: "POST",
        body: JSON.stringify(path === undefined ? {} : {path}),
        signal,
      }), address)
    },
    onCall(event) {
      const record = {
        id: event.id,
        tool: event.name,
        startedAt: event.startedAt,
        address: event.address,
        agentId: event.executorId,
        input: JSON.stringify(mcpResponse.sanitizeValue({name: event.name, arguments: event.arguments})) ?? "",
        status: event.phase === "progress" ? "running" : event.phase,
        durationMs: event.durationMs,
        result: event.phase === "running" ? "" : JSON.stringify(mcpResponse.sanitizeValue(event.phase === "progress" ? {progress: event.progress} : event.phase === "success" ? event.result : {error: event.error})),
      }
      try { options.recordRequest?.(record) } catch { /* Журнал не отменяет исполнение или доставку истории. */ }
      for (const observer of observers.get(event.executorId) ?? []) {
        try { observer(structuredClone(event)) } catch { /* Каждый наблюдатель независим. */ }
      }
    },
  })
  const assignments = new Map<string, {address: string, promise: Promise<Assignment>}>()
  let developer: Promise<Assignment> | undefined
  let disposed = false
  const assignExecutor = (input: {executorId: string, address: string, executorLabel?: string}): Promise<Assignment> => {
    if (disposed) return Promise.reject(new ToolError("ENVIRONMENT_CLOSED", "Окружение завершено", 410))
    if (input.executorId === "developer:project") return Promise.reject(new ToolError("FORBIDDEN", "Identity разработчика Project принадлежит управляющему каналу", 403))
    const current = assignments.get(input.executorId)
    if (current !== undefined) {
      if (current.address !== input.address) return Promise.reject(new ToolError("CONFLICT", "Исполнитель уже назначен другому предмету", 409))
      return current.promise
    }
    const entry = {address: input.address, promise: environment.assign(input)}
    assignments.set(input.executorId, entry)
    void entry.promise.catch(() => { if (assignments.get(input.executorId) === entry) assignments.delete(input.executorId) })
    return entry.promise
  }
  const assignDeveloper = (): Promise<Assignment> => {
    if (developer === undefined) {
      const pending = environment.assign({executorId: "developer:project", address: "/", inspectExecutors: true})
      developer = pending
      void pending.catch(() => { if (developer === pending) developer = undefined })
    }
    return developer
  }
  return {
    resolveSubject,
    readSubject,
    assignExecutor,
    subscribe(executorId: string, observer: (event: CallEvent) => void) {
      const listeners = observers.get(executorId) ?? new Set()
      listeners.add(observer)
      observers.set(executorId, listeners)
      return () => {
        listeners.delete(observer)
        if (listeners.size === 0) observers.delete(executorId)
      }
    },
    revokeExecutor(executorId: string) {
      assignments.delete(executorId)
      if (executorId === "developer:project") developer = undefined
      return environment.revoke(executorId)
    },
    handle: environment.handle,
    /** Один внешний endpoint проверяет штатные полномочия сервера и исполняет через App Environment. */
    async request(request: Request, authority: Authority): Promise<Response> {
      try {
        state.assertExternalStorybookRequestHost(request, authority.origin)
        state.assertExternalStorybookRequestOrigin(request, authority.origin)
        if (disposed) return Response.json({error: {code: "UNAUTHORIZED", message: "Назначение исполнителя недоступно"}}, {status: 401})
        if (state.externalStorybookControlTokenMatches(request.headers.get("authorization"), authority.controlToken)) {
          state.assertExternalStorybookControlRequest(request, authority)
          const assignment = await assignDeveloper()
          const headers = new Headers(request.headers)
          headers.set("authorization", `Bearer ${assignment.token}`)
          return environment.handle(new Request(request, {headers}))
        }
        return environment.handle(request)
      } catch (cause) {
        const error = cause instanceof state.ExternalStorybookSecurityError ? cause : ToolError.from(cause)
        return Response.json({error: {code: error.code, message: error.message}}, {status: error.status, headers: {"cache-control": "no-store"}})
      }
    },
    dispose() {
      disposed = true
      assignments.clear()
      observers.clear()
      notes.dispose()
      developer = undefined
      environment.dispose()
    },
  }
}
