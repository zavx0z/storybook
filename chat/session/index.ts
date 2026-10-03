/**
Ведёт независимые беседы адресов одного Project и сохраняет их вне исполняемой среды.
Переход страницы и отписка наблюдателя сохраняют беседу и текущую работу.
Подключение ACP принадлежит беседе и создаётся по первому сообщению пользователя.

@packageDocumentation
*/
import {createHash, randomUUID} from "node:crypto"
import {link, mkdir, readFile, rename, unlink, writeFile} from "node:fs/promises"
import {isAbsolute, join} from "node:path"
import type {TechAcp} from "@tech/acp"
import type {ChatSession} from "./contract"
import type {Message, Permission, Snapshot, Subject} from "./contract/state"

export type {ChatSession} from "./contract"

type Document = {
  schemaVersion: 1
  id: string
  address: string
  sessionId?: string
  cwd?: string
  messages: Message[]
  status: Snapshot["status"]
  error: string | null
}

type State = {
  subject: Subject
  id: string
  file: string
  document: Document
  version: number
  connection?: TechAcp.Output
  turn?: Promise<void>
  cancelled: boolean
  assistantId?: string
  lifetime: AbortController
  flushTimer?: ReturnType<typeof setTimeout>
  listeners: Set<(value: Snapshot) => void>
  permissions: Map<string, {value: Permission, resolve: (value: Awaited<ReturnType<TechAcp.Input["onPermission"]>>) => void}>
  write: Promise<void>
}

/**
Создаёт владельца бесед без запуска процессов или чтения каталогов заранее.

@param input - Каталог Project, разрешение адресов и фабрика исполнителя.
@returns Действия над независимыми беседами и освобождение принадлежащих ресурсов.
*/
export default function createChatSessions(input: ChatSession.Input): ChatSession.Output {
  const states = new Map<string, Promise<State>>()
  const relocating = new Set<string>()
  let disposed = false
  const snapshot = (state: State): Snapshot => structuredClone({
    id: state.id, address: state.subject.address, label: state.subject.label,
    messages: state.document.messages, status: state.document.status,
    error: state.document.error, permissions: [...state.permissions.values()].map(item => item.value),
    version: state.version,
  })
  const publish = (state: State): void => {
    state.version += 1
    const value = snapshot(state)
    for (const listener of state.listeners) {
      try { listener(value) } catch { /* Отказ одного наблюдателя не отменяет turn. */ }
    }
  }
  const save = (state: State): Promise<void> => {
    const text = `${JSON.stringify(state.document, null, 2)}\n`
    state.write = state.write.catch(() => {}).then(async () => {
      await mkdir(input.directory, {recursive: true})
      const temporary = `${state.file}.${randomUUID()}.tmp`
      await writeFile(temporary, text, {mode: 0o600})
      await rename(temporary, state.file)
    })
    return state.write
  }
  const load = async (address: string): Promise<State> => {
    if (disposed) throw new Error("Чаты остановлены")
    if (relocating.has(address)) throw new Error("Беседа переносится на новый адрес")
    const subject = input.resolve(address)
    let pending = states.get(subject.address)
    if (pending === undefined) {
      pending = (async () => {
        const file = chatFile(input.directory, subject.address)
        const id = createHash("sha256").update(input.directory).update("\0").update(subject.address).digest("hex")
        let document: Document = {schemaVersion: 1, id, address: subject.address, messages: [], status: "idle", error: null}
        try {
          const value: unknown = JSON.parse(await readFile(file, "utf8"))
          if (!validDocument(value, subject.address)) throw new Error(`Повреждена история чата ${subject.address}`)
          document = value
          if (document.status === "connecting" || document.status === "running") {
            document.status = "failed"
            document.error = "Предыдущее выполнение прервано остановкой сервера. Сообщение автоматически не повторялось."
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        }
        return {subject, id: document.id, file, document, version: 0, cancelled: false, lifetime: new AbortController(), listeners: new Set(), permissions: new Map(), write: Promise.resolve()}
      })()
      states.set(subject.address, pending)
      void pending.catch(() => { if (states.get(subject.address) === pending) states.delete(subject.address) })
    }
    const state = await pending
    state.subject = subject
    return state
  }
  const clearPermissions = (state: State): void => {
    for (const permission of state.permissions.values()) permission.resolve({outcome: {outcome: "cancelled"}})
    state.permissions.clear()
  }
  const run = async (state: State, text: string): Promise<void> => {
    const assistantId = randomUUID()
    state.assistantId = assistantId
    let interrupted = false
    try {
      if (state.connection === undefined) {
        if (state.document.cwd !== undefined && state.document.cwd !== state.subject.cwd) {
          throw new Error("Физический контекст сохранённой ACP-сессии изменился")
        }
        const connection = await input.connect({
          subject: state.subject,
          signal: state.lifetime.signal,
          ...(state.document.sessionId === undefined ? {} : {previousSessionId: state.document.sessionId}),
          onUpdate(update) {
            if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") return
            const currentId = state.assistantId
            if (currentId === undefined) return
            const index = state.document.messages.findIndex(message => message.id === currentId)
            if (index === -1) state.document.messages.push({id: currentId, role: "assistant", text: update.content.text})
            else state.document.messages[index] = {...state.document.messages[index]!, text: state.document.messages[index]!.text + update.content.text}
            if (state.flushTimer === undefined) state.flushTimer = setTimeout(() => {
              delete state.flushTimer
              void save(state).catch(error => {
                state.document.error = `Не удалось сохранить ответ: ${error instanceof Error ? error.message : String(error)}`
                publish(state)
              })
            }, 250)
            publish(state)
          },
          onPermission(request) {
            if (state.cancelled || disposed) return Promise.resolve({outcome: {outcome: "cancelled"}})
            const id = randomUUID()
            return new Promise(resolve => {
              state.permissions.set(id, {value: {
                id, title: request.toolCall.title ?? "Разрешение действия",
                options: request.options.map(option => ({id: option.optionId, name: option.name})),
              }, resolve})
              publish(state)
            })
          },
        })
        state.connection = connection
        state.document.sessionId = connection.sessionId
        state.document.cwd = state.subject.cwd
        await save(state)
      }
      if (state.cancelled || disposed) { interrupted = true; return }
      state.document.status = "running"
      publish(state)
      await save(state)
      const result = await state.connection.prompt(text)
      interrupted = result.stopReason === "cancelled"
    } catch (error) {
      interrupted = state.cancelled && state.lifetime.signal.aborted
      state.document.status = interrupted ? "idle" : "failed"
      state.document.error = interrupted ? null : error instanceof Error ? error.message : String(error)
      const connection = state.connection
      delete state.connection
      await connection?.dispose().catch(() => {})
    } finally {
      clearPermissions(state)
      clearTimeout(state.flushTimer)
      delete state.flushTimer
      delete state.assistantId
      if (state.document.status !== "failed") state.document.status = "idle"
      if (interrupted && state.document.status === "idle") {
        state.document.messages.push({id: randomUUID(), role: "system", text: "Выполнение остановлено."})
      }
      delete state.turn
      try { await save(state) } catch (error) {
        state.document.status = "failed"
        state.document.error = `Не удалось сохранить историю: ${error instanceof Error ? error.message : String(error)}`
      }
      publish(state)
    }
  }
  return {
    async read(address) { return snapshot(await load(address)) },
    async prompt(address, text, requestId) {
      if (typeof text !== "string" || text.trim().length === 0 || text.length > 64_000) throw new TypeError("Сообщение должно содержать от 1 до 64000 символов")
      if (typeof requestId !== "string" || requestId.length === 0 || requestId.length > 128) throw new TypeError("Нужен идентификатор отправки")
      const state = await load(address)
      if (relocating.has(address)) throw new Error("Беседа переносится на новый адрес")
      const id = `user:${requestId}`
      const previous = state.document.messages.find(message => message.id === id && message.role === "user")
      if (previous !== undefined) {
        if (previous.text !== text) throw new Error("Идентификатор отправки уже использован для другого сообщения")
        return snapshot(state)
      }
      if (state.turn !== undefined || state.document.status === "connecting" || state.document.status === "running") throw new Error("Дождитесь завершения текущего ответа")
      state.document.messages.push({id, role: "user", text})
      state.document.status = state.connection === undefined ? "connecting" : "running"
      state.document.error = null
      state.cancelled = false
      if (state.lifetime.signal.aborted) state.lifetime = new AbortController()
      publish(state)
      try { await save(state) } catch (error) {
        state.document.messages = state.document.messages.filter(message => message.id !== id)
        state.document.status = "failed"
        state.document.error = `Не удалось сохранить сообщение: ${error instanceof Error ? error.message : String(error)}`
        publish(state)
        throw error
      }
      state.turn = run(state, text)
      return snapshot(state)
    },
    async cancel(address) {
      const state = await load(address)
      if (state.turn === undefined && state.document.status !== "connecting" && state.document.status !== "running") return snapshot(state)
      state.cancelled = true
      clearPermissions(state)
      if (state.connection === undefined) state.lifetime.abort(new Error("Подключение отменено"))
      await state.connection?.cancel()
      publish(state)
      return snapshot(state)
    },
    async permission(address, id, optionId) {
      const state = await load(address)
      const pending = state.permissions.get(id)
      if (pending === undefined || !pending.value.options.some(option => option.id === optionId)) throw new Error("Запрос разрешения или вариант больше не доступен")
      state.permissions.delete(id)
      pending.resolve({outcome: {outcome: "selected", optionId}})
      publish(state)
      return snapshot(state)
    },
    async subscribe(address, listener) {
      const state = await load(address)
      if (relocating.has(address)) throw new Error("Беседа переносится на новый адрес")
      state.listeners.add(listener)
      listener(snapshot(state))
      return () => { state.listeners.delete(listener) }
    },
    async relocate({from, to}) {
      if (disposed) throw new Error("Чаты остановлены")
      if (typeof from?.address !== "string" || typeof to?.address !== "string" ||
        !from.address.startsWith("/") || !to.address.startsWith("/") ||
        /[?#]/u.test(from.address) || /[?#]/u.test(to.address) ||
        from.address === to.address || typeof from.cwd !== "string" || typeof to.cwd !== "string" ||
        !isAbsolute(from.cwd) || !isAbsolute(to.cwd)) {
        throw new TypeError("Нужно точное соответствие прежнего и нового адреса и cwd")
      }
      if (relocating.has(from.address) || relocating.has(to.address)) {
        throw new Error("Беседа уже переносится")
      }
      relocating.add(from.address)
      relocating.add(to.address)
      let moved = false
      try {
        const subject = input.resolve(to.address)
        if (subject.address !== to.address || subject.cwd !== to.cwd) {
          throw new Error("Новый адрес и cwd не совпадают с текущим каталогом")
        }
        const oldFile = chatFile(input.directory, from.address)
        const newFile = chatFile(input.directory, to.address)
        const current = await states.get(from.address)
        const existing = await states.get(to.address)
        if (current?.turn !== undefined || current?.permissions.size ||
          current?.document.status === "connecting" || current?.document.status === "running" ||
          existing?.turn !== undefined || existing?.document.status === "connecting" ||
          existing?.document.status === "running") {
          throw new Error("Активную беседу нельзя переносить до завершения turn")
        }
        await current?.write
        const source = await readChatDocument(oldFile, from.address)
        if (source === null) return null
        if (current !== undefined && (current.id !== source.id || current.document.address !== from.address)) {
          throw new Error("Загруженная беседа не совпадает с сохранённой историей")
        }
        if (source.cwd !== undefined && source.cwd !== from.cwd) {
          throw new Error("Сохранённый cwd не совпадает с прежним владельцем беседы")
        }
        const target = await readChatDocument(newFile, to.address)
        if (target !== null) {
          if (target.id !== source.id || target.cwd !== undefined && target.cwd !== to.cwd ||
            existing !== undefined && existing.id !== source.id) {
            throw new Error("Новый адрес уже занят другой беседой")
          }
          if (current !== undefined && existing === undefined) {
            await current.connection?.dispose()
            delete current.connection
            current.subject = subject
            current.file = newFile
            current.document = target
            states.delete(from.address)
            states.set(to.address, Promise.resolve(current))
            publish(current)
          }
          moved = true
        } else {
          if (existing !== undefined) throw new Error("Новый адрес уже занят другой беседой")
          await current?.connection?.dispose()
          if (current !== undefined) delete current.connection
          const document: Document = {
            ...source,
            address: to.address,
            ...(source.cwd === undefined ? {} : {cwd: to.cwd}),
          }
          await mkdir(input.directory, {recursive: true})
          const temporary = `${newFile}.${randomUUID()}.tmp`
          try {
            await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {mode: 0o600, flag: "wx"})
            await link(temporary, newFile)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
            const concurrent = await readChatDocument(newFile, to.address)
            if (concurrent?.id !== source.id || concurrent.cwd !== document.cwd) {
              throw new Error("Новый адрес уже занят другой беседой")
            }
          } finally {
            await unlink(temporary).catch(error => {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
            })
          }
          if (current !== undefined) {
            current.subject = subject
            current.file = newFile
            current.document = document
            states.delete(from.address)
            states.set(to.address, Promise.resolve(current))
            publish(current)
          }
          moved = true
        }
      } finally {
        relocating.delete(from.address)
        relocating.delete(to.address)
      }
      return moved ? snapshot(await load(to.address)) : null
    },
    async dispose() {
      if (disposed) return
      disposed = true
      const results = await Promise.allSettled([...states.values()].map(async pending => {
        const state = await pending.catch(() => undefined)
        if (state === undefined) return
        state.cancelled = true
        state.lifetime.abort(new Error("Сервер чатов останавливается"))
        clearPermissions(state)
        try {
          await state.connection?.dispose()
        } finally {
          await state.turn
          await state.write
          state.listeners.clear()
        }
      }))
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected")
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Не все чаты удалось освободить")
    },
  }
}

function chatFile(directory: string, address: string): string {
  return join(directory, `${createHash("sha256").update(address).digest("hex")}.json`)
}

async function readChatDocument(file: string, address: string): Promise<Document | null> {
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
  const value: unknown = JSON.parse(text)
  if (!validDocument(value, address)) throw new Error(`Повреждена история чата ${address}`)
  return value
}

function validDocument(value: unknown, address: string): value is Document {
  if (value === null || typeof value !== "object") return false
  const document = value as Document
  return document.schemaVersion === 1 && typeof document.id === "string" && document.address === address &&
    Array.isArray(document.messages) && document.messages.every(message => message &&
      typeof message.id === "string" && ["user", "assistant", "system"].includes(message.role) && typeof message.text === "string") &&
    ["idle", "connecting", "running", "failed"].includes(document.status) &&
    (document.error === null || typeof document.error === "string") &&
    (document.sessionId === undefined || typeof document.sessionId === "string") &&
    (document.cwd === undefined || typeof document.cwd === "string")
}
