/**
Назначает исполнителю самостоятельное окружение предмета текущего Project.
Хост закрепляет identity, файловую область и права инспекции; модель получает
стартовый контекст и описания действительно доступных команд. Подробные знания
раскрывает существующая предметная проекция по обращению.

Назначение сохраняет свои возможности независимо от подключения модели.
Несколько исполнителей одного предмета имеют собственные bearer и жизненные циклы.
Окружение использует публичные инструменты владельцев и передаёт их результаты
общему HTTP-входу. Адаптер модели, история беседы и listener остаются у хоста.

@packageDocumentation
*/
import {createHash, randomBytes, randomUUID} from "node:crypto"
import createEntityTools from "@zavx0z/storybook-app-environment-tools"
import ToolError from "@zavx0z/ai-tech-failure"
import type {StorybookAppEnvironment as Contract} from "./contract"
import type {Bootstrap} from "./contract/context"
import type {CallEvent} from "./contract/events"
import {inspectDescription, knowledgeDescription, protocol} from "./src/descriptions"
import declaration from "@zavx0z/storybook-app-environment-declaration"
import {readSource} from "./src/source"
import {relative} from "node:path"
import {failure, identity, object, readCommand, reply} from "./src/http"

export type {StorybookAppEnvironment} from "./contract"

type BoundAssignment = {
  executorId: string
  address: string
  digest: string
  tools: ReturnType<typeof createEntityTools>
  declaration: ReturnType<typeof declaration>
  bootstrap: Bootstrap
  inspectExecutors: boolean
}

/**
Создаёт окружение с назначением предметов и отложенным чтением знаний хоста.

@param options - Resolver существующих предметов, scoped reader знаний и необязательный наблюдатель вызовов.

@returns Назначение, отзыв и HTTP-исполнение команд без запуска модели или listener.

@example
```ts
const environment = createEnvironment({resolve: resolveSubject, readKnowledge: readScopedKnowledge})
const assignment = await environment.assign({executorId: "worker-1", address: "/storybook/package"})
const response = await environment.handle(new Request("http://localhost/api/environment", {
  headers: {authorization: `Bearer ${assignment.token}`},
}))
environment.revoke("worker-1")
```
*/
export default function createEnvironment(options: Contract.Input): Contract.Output {
  const executors = new Map<string, BoundAssignment>()
  const grants = new Map<string, BoundAssignment>()
  const pending = new Map<string, symbol>()
  let disposed = false
  const assertOpen = () => {
    if (disposed) throw new ToolError("ENVIRONMENT_CLOSED", "Окружение завершено", 410)
  }
  const assertActive = (assignment: BoundAssignment) => {
    if (grants.get(assignment.digest) !== assignment) {
      throw new ToolError("UNAUTHORIZED", "Назначение исполнителя недоступно", 401)
    }
  }
  const observe = (event: CallEvent) => {
    try { void Promise.resolve(options.onCall?.(structuredClone(event))).catch(() => {}) }
    catch { /* Наблюдатель не меняет исполнение команды. */ }
  }
  const readDocument = async (address: string, args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> => {
    if (Object.hasOwn(args, "path") && typeof args.path !== "string") {
      throw new ToolError("INVALID_INPUT", "path является адресом из children")
    }
    const response = await options.readKnowledge({
      address,
      ...(typeof args.path === "string" ? {path: args.path} : {}),
      signal,
    })
    if (!response.ok) {
      throw new ToolError("KNOWLEDGE_READ_FAILED", "Не удалось прочитать знания назначенной сущности", response.status)
    }
    const result: unknown = await response.json()
    if (result === null || typeof result !== "object" || Array.isArray(result)) {
      throw new ToolError("INVALID_RESULT", "Читатель знаний возвращает JSON-объект", 502)
    }
    return result as Record<string, unknown>
  }
  const readAssignmentDocument = async (assignment: BoundAssignment, args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> => {
      const root = "./environment/documents"
      const documents = Object.entries(assignment.declaration.documents)
      if (args.path === root) return {path: root, description: "Документы окружения", children: documents.map(([key]) => ({path: `${root}/${encodeURIComponent(key)}`, description: key}))}
      const source = documents.find(([key]) => args.path === `${root}/${encodeURIComponent(key)}`)
      if (source !== undefined) {
        const result = await readSource(source[1].path)
        assertActive(assignment)
        signal.throwIfAborted()
        return {path: args.path, ...result, children: []}
      }
      return readDocument(assignment.address, args, signal)
  }
  const execute = async (assignment: BoundAssignment, command: Awaited<ReturnType<typeof readCommand>>, signal: AbortSignal,
    onProgress?: (progress: Readonly<Record<string, unknown>>) => void | Promise<void>) => {
    assertActive(assignment)
    signal.throwIfAborted()
    if (command.name === "knowledge.read") {
      return readAssignmentDocument(assignment, object(command.arguments, ["path"]), signal)
    }
    if (command.name === "environment.inspect") {
      if (!assignment.inspectExecutors) throw new ToolError("FORBIDDEN", "Инспекция исполнителей не назначена", 403)
      const args = object(command.arguments, ["executorId", "path"])
      const executorId = identity(args.executorId, "executorId")
      const target = executors.get(executorId)
      if (target === undefined) throw new ToolError("NOT_FOUND", "Назначение исполнителя отсутствует", 404)
      if (Object.hasOwn(args, "path")) {
        const document = await readAssignmentDocument(target, args, signal)
        assertActive(assignment)
        if (executors.get(executorId) !== target) throw new ToolError("NOT_FOUND", "Назначение исполнителя отозвано во время инспекции", 404)
        return {...structuredClone(target.bootstrap), document}
      }
      return structuredClone(target.bootstrap) as Record<string, unknown>
    }
    return assignment.tools.call(command, signal, onProgress)
  }
  return Object.freeze({
    async assign(input) {
      assertOpen()
      const args = object(input, ["executorId", "executorLabel", "address", "inspectExecutors"])
      const executorId = identity(args.executorId, "executorId")
      const address = identity(args.address, "address")
      if (args.executorLabel !== undefined && (typeof args.executorLabel !== "string" || !args.executorLabel.trim() || args.executorLabel.length > 128)) {
        throw new ToolError("INVALID_INPUT", "Имя исполнителя должно содержать от 1 до 128 символов")
      }
      if (!address.startsWith("/") || address.startsWith("//") || /[?#]/u.test(address)) {
        throw new ToolError("INVALID_INPUT", "Нужен канонический адрес предмета Project")
      }
      if (args.inspectExecutors !== undefined && typeof args.inspectExecutors !== "boolean") {
        throw new ToolError("INVALID_INPUT", "inspectExecutors является правом, назначенным хостом")
      }
      const inspectExecutors = args.inspectExecutors === true
      if (inspectExecutors && address !== "/") {
        throw new ToolError("FORBIDDEN", "Инспекция исполнителей назначается только в области Project", 403)
      }
      if (executors.has(executorId) || pending.has(executorId)) {
        throw new ToolError("CONFLICT", "Исполнитель уже имеет назначение", 409)
      }
      const reservation = Symbol(executorId)
      pending.set(executorId, reservation)
      try {
        const subject = await options.resolve(address)
        assertOpen()
        if (pending.get(executorId) !== reservation) throw new ToolError("UNAUTHORIZED", "Назначение отозвано до завершения подготовки", 401)
        if (subject.address !== address) throw new ToolError("INVALID_CONFIGURATION", "Resolver изменил назначенный адрес", 500)
        if (address === "/" && subject.type !== "Project" || address !== "/" && subject.type === "Project") {
          throw new ToolError("INVALID_CONFIGURATION", "Тип Project соответствует только корневому адресу", 500)
        }
        const declared = declaration({directory: subject.directory, ...(subject.type === undefined ? {} : {type: subject.type})})
        const extensions = await options.extensions?.({executorId, subject, inspectExecutors})
        assertOpen()
        if (pending.get(executorId) !== reservation) throw new ToolError("UNAUTHORIZED", "Назначение отозвано до подготовки инструментов", 401)
        const inherited = await options.instructions?.({executorId, subject, inspectExecutors}) ?? []
        const local = await Promise.all(Object.values(declared.rules).map(async source => ({
          source: relative(subject.projectDirectory ?? subject.directory, source.path).split("\\").join("/"), ...await readSource(source.path),
        })))
        const instructions = [...inherited, ...local]
        assertOpen()
        if (pending.get(executorId) !== reservation) throw new ToolError("UNAUTHORIZED", "Назначение отозвано до завершения чтения правил", 401)
        if (!Array.isArray(instructions) || instructions.some(instruction => instruction === null || typeof instruction !== "object"
          || Object.keys(instruction).some(key => !["source", "content", "contentHash"].includes(key))
          || typeof instruction.source !== "string" || !instruction.source
          || instruction.source.startsWith("/") || /^[A-Za-z]:/u.test(instruction.source) || instruction.source.includes("\\")
          || instruction.source.split("/").some((segment: string) => segment === "..")
          || typeof instruction.content !== "string"
          || instruction.contentHash !== undefined && (typeof instruction.contentHash !== "string" || !/^[a-f0-9]{64}$/u.test(instruction.contentHash)))) {
          throw new ToolError("INVALID_RESULT", "Правила возвращают source относительно Project и полный content", 500)
        }
        const tools = createEntityTools({directory: subject.directory, declaration: declared, ...(subject.type === undefined ? {} : {type: subject.type}),
          ...(extensions === undefined ? {} : {extensions})})
        const descriptions = tools.list()
        if (descriptions.some(tool => [knowledgeDescription.name, inspectDescription.name].includes(tool.name))) {
          throw new ToolError("INVALID_CONFIGURATION", "Предметный инструмент повторяет команду окружения", 500)
        }
        const bootstrap: Bootstrap = {
          executorId,
          ...(typeof args.executorLabel === "string" ? {executorLabel: args.executorLabel.trim()} : {}),
          subject: {address, label: subject.label, ...(subject.type === undefined ? {} : {type: subject.type})},
          protocol,
          tools: [...descriptions, knowledgeDescription, ...(inspectExecutors ? [inspectDescription] : [])],
          knowledge: [{path: "./environment/documents", description: "Документы объявленного окружения по требованию"}, {path: ".", description: "Начальная точка знаний назначенного предмета; children раскрывает доступные подробности и общие правила."}],
          instructions: structuredClone(instructions),
        }
        const token = randomBytes(32).toString("base64url")
        const digest = createHash("sha256").update(token).digest("hex")
        const assignment = {executorId, address, digest, tools, declaration: declared, bootstrap: structuredClone(bootstrap), inspectExecutors}
        executors.set(executorId, assignment)
        grants.set(digest, assignment)
        return Object.freeze({token, bootstrap: structuredClone(bootstrap)})
      } finally {
        if (pending.get(executorId) === reservation) pending.delete(executorId)
      }
    },
    revoke(executorId) {
      const preparing = pending.delete(executorId)
      const assignment = executors.get(executorId)
      if (assignment === undefined) return preparing
      executors.delete(executorId)
      grants.delete(assignment.digest)
      return true
    },
    async handle(request) {
      const id = randomUUID()
      try {
        const token = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(request.headers.get("authorization") ?? "")?.[1]
        const assignment = token === undefined ? undefined : grants.get(createHash("sha256").update(token).digest("hex"))
        if (assignment === undefined) throw new ToolError("UNAUTHORIZED", "Назначение исполнителя недоступно", 401)
        if (new URL(request.url).search !== "") throw new ToolError("INVALID_INPUT", "Аргументы передаются в JSON-команде, без query")
        if (request.method === "GET") return reply({result: structuredClone(assignment.bootstrap)}, id)
        if (request.method !== "POST") throw new ToolError("METHOD_NOT_ALLOWED", "Ожидается GET или POST", 405)
        const command = await readCommand(request)
        assertActive(assignment)
        if (assignment.tools.list().some(tool => tool.name === command.name)) {
          await options.authorize?.({id, executorId: assignment.executorId, address: assignment.address, command, signal: request.signal})
          assertActive(assignment)
          request.signal.throwIfAborted()
        }
        const startedAt = Date.now()
        const event = {id, executorId: assignment.executorId, address: assignment.address,
          name: command.name, arguments: command.arguments, startedAt}
        observe({...event, phase: "running", durationMs: null})
        const listeners = new Set<(progress: Readonly<Record<string, unknown>>) => void>()
        const onProgress = (progress: Readonly<Record<string, unknown>>) => {
          observe({...event, phase: "progress", durationMs: Date.now() - startedAt, progress})
          for (const listener of listeners) listener(structuredClone(progress))
        }
        const run = async (): Promise<{value: Record<string, unknown>, status: number}> => {
          try {
            const result = await execute(assignment, command, request.signal, onProgress)
            observe({...event, phase: "success", durationMs: Date.now() - startedAt, result})
            return {value: {result}, status: 200}
          } catch (cause) {
            const value = failure(cause)
            observe({...event, phase: "failed", durationMs: Date.now() - startedAt, error: value.error})
            return {value: {error: value.error}, status: value.status}
          }
        }
        if (options.stream !== undefined && request.headers.get("accept")?.includes("application/x-ndjson")) {
          const response = options.stream(request.signal, listener => {
            listeners.add(listener)
            return () => { listeners.delete(listener) }
          }, async () => (await run()).value)
          response.headers.set("x-request-id", id)
          return response
        }
        const result = await run()
        return reply(result.value, id, result.status)
      } catch (cause) {
        const value = failure(cause)
        return reply({error: value.error}, id, value.status)
      }
    },
    dispose() {
      disposed = true
      pending.clear()
      grants.clear()
      executors.clear()
    },
  } satisfies Contract.Output)
}
