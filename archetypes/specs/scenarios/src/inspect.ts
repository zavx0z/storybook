import {resolve} from "node:path"
import type {ReadScenarioOutput} from "../contract/output"

type RemoteValue = {type: string, subtype?: string, value?: unknown, description?: string, objectId?: string}
type Frame = {functionName: string, location: {scriptId: string, lineNumber: number, columnNumber: number}, scopeChain: Array<{type: string, object: RemoteValue}>}
type InspectorEvent = {method: string, params: Record<string, unknown>}

/**
Параметры пробного сбора через отладчик.

@property path - Исполняемый файл теста.
@property lines - Номера строк для остановок с единицы в скрипте, который видит инспектор.
Автоматическое сопоставление исходного TypeScript через sourcemap пока не реализовано.
*/
interface InspectorScenarioInput {
  readonly path: string
  readonly lines: readonly number[]
}

/**
Запускает настоящий Bun Test с отдельным инспектором и собирает события TestReporter.
В остановках читает доступные неглобальные области видимости, не вызывая getters.
Вложенные объекты раскрываются до пяти уровней; граница и повторные ссылки помечаются.

@returns Результат настоящего тестового запуска и наблюдения в выбранных остановках.
@throws Ошибка запуска, протокола инспектора или превышение 30 секунд.
*/
export async function inspectScenario({path, lines}: InspectorScenarioInput): Promise<ReadScenarioOutput> {
  path = resolve(path)
  const env: NodeJS.ProcessEnv = {...process.env, FORCE_COLOR: "0", NO_COLOR: "1"}
  delete env.BUN_INSPECT
  delete env.BUN_INSPECT_NOTIFY
  const child = Bun.spawn([process.execPath, "--inspect-wait=127.0.0.1:0", "test", path], {env, stdout: "pipe", stderr: "pipe"})
  const events: InspectorEvent[] = []
  const pauses: ReadScenarioOutput["pauses"] = []
  const scripts = new Map<string, string>()
  let stderr = ""
  let socket: WebSocket | undefined
  let nextId = 0
  const pending = new Map<number, {resolve: (value: Record<string, unknown>) => void, reject: (error: Error) => void}>()
  const endpoint = Promise.withResolvers<string>()
  const connectionClosed = Promise.withResolvers<void>()
  const abort = Promise.withResolvers<never>()
  let inspecting = Promise.resolve()
  const timer = setTimeout(() => {
    child.kill()
    abort.reject(new Error("Превышен срок проверки через инспектор"))
  }, 30_000)
  const stderrTask = (async () => {
    for await (const chunk of child.stderr) {
      stderr += new TextDecoder().decode(chunk)
      const match = stderr.match(/ws:\/\/[^\s]+/)
      if (match) endpoint.resolve(match[0])
    }
    endpoint.reject(new Error(`Инспектор не открыл соединение: ${stderr}`))
  })()
  const stdoutTask = new Response(child.stdout).text()
  function request(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++nextId
    return Promise.race([new Promise<Record<string, unknown>>((resolve, reject) => {
      pending.set(id, {resolve, reject})
      socket!.send(JSON.stringify({id, method, params}))
    }), abort.promise])
  }
  async function value(remote: RemoteValue, depth = 0, seen = new Set<string>()): Promise<unknown> {
    if ("value" in remote) return remote.value
    if (!remote.objectId || remote.type === "function") return {type: remote.type, description: remote.description}
    if (depth >= 5 || seen.has(remote.objectId)) return {type: remote.type, description: remote.description, truncated: true}
    seen.add(remote.objectId)
    const response = await request("Runtime.getProperties", {objectId: remote.objectId, ownProperties: true})
    const properties = response.properties as Array<{name: string, value?: RemoteValue, get?: RemoteValue}>
    const entries = []
    for (const property of properties) {
      if (property.name === "__proto__") continue
      entries.push([property.name, property.value ? await value(property.value, depth + 1, new Set(seen)) : {getter: Boolean(property.get)}])
    }
    return {type: remote.type, subtype: remote.subtype, properties: Object.fromEntries(entries)}
  }
  async function paused(params: Record<string, unknown>) {
    const frames = params.callFrames as Frame[]
    const selected = frames.filter(frame => scripts.get(frame.location.scriptId) === path || scripts.get(frame.location.scriptId) === `file://${path}`)
    if (selected.length) {
      const captured = []
      for (const frame of selected) {
        const scopes = []
        for (const scope of frame.scopeChain) {
          if (scope.type === "global" || scope.type === "globalLexicalEnvironment") continue
          scopes.push({type: scope.type, value: await value(scope.object)})
        }
        captured.push({functionName: frame.functionName, location: frame.location, scopes})
      }
      pauses.push({reason: params.reason, frames: captured})
    }
    await request("Debugger.resume")
  }
  try {
    const url = await Promise.race([endpoint.promise, abort.promise])
    socket = new WebSocket(url)
    socket.addEventListener("close", () => {
      for (const waiter of pending.values()) waiter.reject(new Error("Соединение инспектора закрыто"))
      pending.clear()
      connectionClosed.resolve()
    })
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data)) as {id?: number, result?: Record<string, unknown>, error?: {message: string}, method?: string, params?: Record<string, unknown>}
      if (message.id !== undefined) {
        const waiter = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) waiter?.reject(new Error(message.error.message))
        else waiter?.resolve(message.result ?? {})
      } else if (message.method) {
        const params = message.params ?? {}
        if (message.method === "Debugger.scriptParsed") scripts.set(String(params.scriptId), String(params.url))
        if (message.method.startsWith("TestReporter.") || message.method.startsWith("LifecycleReporter.") || message.method.startsWith("Console.") || message.method === "Debugger.breakpointResolved") events.push({method: message.method, params})
        if (message.method === "Debugger.paused") {
          inspecting = inspecting.then(() => paused(params)).catch(error => {
            abort.reject(error)
            child.kill()
          })
        }
      }
    })
    await Promise.race([new Promise<void>((resolve, reject) => {
      socket!.addEventListener("open", () => resolve(), {once: true})
      socket!.addEventListener("error", () => reject(new Error("Не удалось подключиться к инспектору")), {once: true})
    }), abort.promise])
    await request("Inspector.enable")
    await request("Runtime.enable")
    await request("Debugger.enable")
    await request("Debugger.setBreakpointsActive", {active: true})
    await request("TestReporter.enable")
    await request("LifecycleReporter.enable")
    await request("Console.enable")
    for (const line of lines) await request("Debugger.setBreakpointByUrl", {lineNumber: line - 1, urlRegex: path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})
    await request("Inspector.initialized")
    const exitCode = await Promise.race([child.exited, abort.promise])
    await Promise.race([connectionClosed.promise, abort.promise])
    await stderrTask
    await inspecting
    return {path, exitCode, stdout: await stdoutTask, stderr, events, pauses}
  } finally {
    clearTimeout(timer)
    socket?.close()
    if (child.exitCode === null) child.kill()
    for (const waiter of pending.values()) waiter.reject(new Error("Соединение инспектора закрыто"))
    pending.clear()
  }
}

if (import.meta.main) {
  const path = process.argv[2]
  if (!path) throw new Error("Нужен путь сценария")
  const result = await inspectScenario({path, lines: process.argv.slice(3).map(Number)})
  console.log(JSON.stringify(result, null, 2))
}
