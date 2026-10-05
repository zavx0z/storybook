/**
Ведёт независимые беседы исполнителей предметов одного Project и сохраняет их предметную историю
вне исполняемой среды. Сообщения, инструменты, supplied context и результаты turn
образуют одну timeline; прежние текстовые messages выводятся из неё для потребителей.
Переход страницы и отписка наблюдателя сохраняют беседу и текущую работу.
Подключение ACP принадлежит беседе и создаётся по первому сообщению или открытию настроек.

@packageDocumentation
*/
import {createHash, randomUUID} from "node:crypto"
import {link, mkdir, readFile, readdir, rename, unlink, writeFile} from "node:fs/promises"
import {dirname, isAbsolute, join} from "node:path"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"
import type {StorybookChatSession} from "./contract"
import type {Permission, Snapshot, Subject, Setting} from "./contract/state"
import type {Environment} from "./contract/environment"
import type {Target} from "./contract/target"

import type {Document} from "./src/document"
import type {Cursor} from "./src/timeline"
import {chatFile, copyHistory, readChatDocument} from "./src/storage"
import {decodeDocument} from "./src/validation"
import {readSettings} from "./src/settings"
import readCommand from "./src/command"
import {executorIdentity, targetParts, targetKey} from "./src/target"
import {defaultExecutorId} from "./src/identity"
import {interruptedRequest, queuedContent, requestIdentity} from "./src/queue"
import {movedSource, readMoveIntent, sameMove, writeMoveIntent} from "./src/relocation"
import {inputContent, nextSequence, receiveUpdate, recordMessage, textMessages} from "./src/timeline"

export type {StorybookChatSession} from "./contract"

type State = {
  key: string
  isDefault: boolean
  mutations: Promise<void>
  draining?: Promise<void>
  retryBlocked: boolean
  moveBlocked: boolean
  subject: Subject
  id: string
  file: string
  document: Document
  version: number
  connection?: StorybookTechAcp.Output
  environment?: Environment
  connecting?: Promise<StorybookTechAcp.Output>
  settings?: readonly Setting[]
  configuring?: boolean
  progress?: string
  turn?: Promise<void>
  turnController?: AbortController
  cancelled: boolean
  cursor: Cursor
  lifetime: AbortController
  flushTimer?: ReturnType<typeof setTimeout>
  listeners: Set<(value: Snapshot) => void>
  permissions: Map<string, {value: Permission, resolve: (value: Awaited<ReturnType<StorybookTechAcp.Input["onPermission"]>>) => void}>
  write: Promise<void>
}

/**
Создаёт владельца бесед без запуска процессов или чтения каталогов заранее.

@param input - Хранилище предмета, разрешение адресов и фабрика исполнителя.
@returns Действия над независимыми беседами и освобождение принадлежащих ресурсов.
*/
export default function createChatSessions(input: StorybookChatSession.Input): StorybookChatSession.Output {
  const states = new Map<string, Promise<State>>()
  const relocating = new Set<string>()
  let disposed = false
  const snapshot = (state: State): Snapshot => structuredClone({
    id: state.id, executorId: state.document.executorId, executorLabel: state.document.executorLabel, pending: state.document.pending, address: state.subject.address, label: state.subject.label,
    messages: textMessages(state.document.timeline), timeline: state.document.timeline, capabilities: state.connection?.capabilities ?? null, status: state.document.status,
    error: state.document.error, permissions: [...state.permissions.values()].map(item => item.value),
    version: state.version,
    ...(state.progress === undefined ? {} : {progress: state.progress}),
    settings: state.settings ?? [], configuring: state.configuring === true, usage: state.document.usage ?? null,
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
      await mkdir(dirname(state.file), {recursive: true})
      const temporary = `${state.file}.${randomUUID()}.tmp`
      await writeFile(temporary, text, {mode: 0o600})
      await rename(temporary, state.file)
    })
    return state.write
  }
  const scheduleSave = (state: State): void => {
    if (state.flushTimer !== undefined) return
    state.flushTimer = setTimeout(() => {
      delete state.flushTimer
      void save(state).catch(error => {
        state.document.error = `Не удалось сохранить историю: ${error instanceof Error ? error.message : String(error)}`
        publish(state)
      })
    }, 250)
  }
  const exclusive = <T>(state: State, action: () => T | Promise<T>): Promise<T> => {
    const pending = state.mutations.then(action, action)
    state.mutations = pending.then(() => {}, () => {})
    return pending
  }
  const makeState = (subject: Subject, file: string, document: Document, isDefault: boolean): State => {
    if (document.status === "connecting" || document.status === "running") {
      document.historyComplete = false
      document.status = "failed"
      document.error = "Предыдущее выполнение прервано остановкой сервера. Сообщение автоматически не повторялось."
      const requestId = interruptedRequest(document)
      if (requestId !== undefined) document.timeline.push({id: randomUUID(), sequence: nextSequence(document.timeline), origin: "local",
        kind: "turn", requestId, state: "failed", error: document.error})
    }
    return {
      key: targetKey(subject.address, isDefault ? undefined : document.executorId), isDefault,
      mutations: Promise.resolve(), retryBlocked: false, moveBlocked: false, subject, id: document.id, file, document,
      version: 0, cancelled: false, cursor: {replayed: new Set()}, lifetime: new AbortController(),
      listeners: new Set(), permissions: new Map(), write: Promise.resolve(),
    }
  }
  const emptyDefault = (subject: Subject): Document => {
    const directory = input.directory(subject)
    const id = createHash("sha256").update(input.legacyDirectory ?? directory).update("\0").update(subject.address).digest("hex")
    return {schemaVersion: 2, id, executorId: defaultExecutorId(id), executorLabel: "Основной", address: subject.address,
      timeline: [], pending: [], historyComplete: true, status: "idle", error: null}
  }
  const loaded = async (address: string, executorId?: string): Promise<State | undefined> => {
    if (executorId === undefined) return await states.get(targetKey(address))
    for (const [key, pending] of states) {
      if (!key.startsWith(`[${JSON.stringify(address)},`)) continue
      const state = await pending.catch(() => undefined)
      if (state !== undefined && state.subject.address === address && state.document.executorId === executorId) return state
    }
    return undefined
  }
  const load = async (target: Target): Promise<State> => {
    if (disposed) throw new Error("Чаты остановлены")
    const {address, executorId} = targetParts(target)
    const subject = input.resolve(address)
    const requested = targetKey(subject.address, executorId)
    if (relocating.has(requested)) throw new Error("Беседа переносится на новый адрес")
    let current = await loaded(subject.address, executorId)
    if (current !== undefined) {
      if (relocating.has(current.key)) throw new Error("Беседа переносится на новый адрес")
      const move = await movedSource(current.file, current.document)
      if (move !== null) {
        current.moveBlocked = true
        throw new Error(`Беседа перенесена или ожидает завершения переноса на ${move.to.address}`)
      }
      current.subject = subject
      wake(current)
      return current
    }
    let isDefault = executorId === undefined
    let file = chatFile(input.directory(subject), subject.address, executorId)
    let prepared: Document | null | undefined
    if (executorId !== undefined) {
      prepared = await readChatDocument(file, subject.address)
      if (prepared === null) {
        const defaultFile = chatFile(input.directory(subject), subject.address)
        const defaultDocument = await readChatDocument(defaultFile, subject.address)
          ?? (input.legacyDirectory === undefined ? null : await readChatDocument(chatFile(input.legacyDirectory, subject.address), subject.address))
          ?? emptyDefault(subject)
        if (defaultDocument.executorId !== executorId) throw new Error("Исполнитель не найден у выбранного предмета")
        isDefault = true
        file = defaultFile
        prepared = defaultDocument
      }
      if (prepared.executorId !== executorId) throw new Error("Identity файла не совпадает с выбранным исполнителем")
    }
    const key = targetKey(subject.address, isDefault ? undefined : executorId)
    if (relocating.has(key)) throw new Error("Беседа переносится на новый адрес")
    let pending = states.get(key)
    if (pending === undefined) {
      pending = (async () => {
        let document = emptyDefault(subject)
        let value = prepared ?? await readChatDocument(file, subject.address)
        if (value === null && isDefault && input.legacyDirectory !== undefined) {
          const legacy = await readChatDocument(chatFile(input.legacyDirectory, subject.address), subject.address)
          if (legacy !== null) {
            const move = await movedSource(file, legacy)
            if (move !== null) throw new Error(`Беседа перенесена или ожидает завершения переноса на ${move.to.address}`)
            value = await copyHistory(file, legacy)
          }
        }
        if (value !== null) document = value
        const move = await movedSource(file, document)
        if (move !== null) throw new Error(`Беседа перенесена или ожидает завершения переноса на ${move.to.address}`)
        if (!isDefault && document.executorId !== executorId) throw new Error("Identity файла не совпадает с выбранным исполнителем")
        return makeState(subject, file, document, isDefault)
      })()
      states.set(key, pending)
      void pending.catch(() => { if (states.get(key) === pending) states.delete(key) })
    }
    current = await pending
    current.subject = subject
    wake(current)
    return current
  }
  const clearPermissions = (state: State): void => {
    for (const permission of state.permissions.values()) permission.resolve({outcome: {outcome: "cancelled"}})
    state.permissions.clear()
  }
  /** Одна ACP-сессия для настроек и сообщений; подготовка не запускает prompt. */
  const connect = async (state: State): Promise<StorybookTechAcp.Output> => {
    if (state.connection !== undefined) return state.connection
    if (state.connecting !== undefined) return state.connecting
    state.cursor = {replayed: new Set()}
    const pending = (async () => {
      if (state.document.cwd !== undefined && state.document.cwd !== state.subject.cwd) {
        throw new Error("Физический контекст сохранённой ACP-сессии изменился")
      }
      if (state.environment === undefined && input.environment !== undefined) {
        state.environment = await input.environment({
          executorId: state.document.executorId,
          executorLabel: state.document.executorLabel,
          address: state.subject.address,
          onUpdate(update) {
            receiveUpdate(state.document.timeline, update, "local", state.cursor)
            scheduleSave(state)
            publish(state)
          },
        })
      }
      const connection = await input.connect({
        subject: state.subject,
        executorId: state.document.executorId,
        executorLabel: state.document.executorLabel,
        signal: state.lifetime.signal,
        ...(state.document.sessionId === undefined ? {} : {previousSessionId: state.document.sessionId}),
        preferResume: state.document.historyComplete,
        onProgress(phase) {
          state.progress = {
            registry: "Подготовка инструментов агента…",
            spawn: "Запуск агента…",
            initialize: "Подключение к агенту…",
            session: "Загрузка сессии и доступных моделей…",
            ready: "Настройки получены",
          }[phase]
          publish(state)
        },
        async onReplay(update) {
          receiveUpdate(state.document.timeline, update, "replay", state.cursor)
          if (update.sessionUpdate === "config_option_update") state.settings = readSettings(update.configOptions)
          if (update.sessionUpdate === "usage_update" && Number.isFinite(update.used) && update.used >= 0 && Number.isFinite(update.size) && update.size > 0) state.document.usage = {used: update.used, size: update.size}
          scheduleSave(state)
          publish(state)
        },
        onUpdate(update) {
          receiveUpdate(state.document.timeline, update, "live", state.cursor)
          if (update.sessionUpdate === "config_option_update") {
            const previousModel = state.settings?.find(option => option.category === "model")?.value
            state.settings = readSettings(update.configOptions)
            if (previousModel !== undefined && previousModel !== state.settings.find(option => option.category === "model")?.value) delete state.document.usage
          }
          if (update.sessionUpdate === "usage_update" && Number.isFinite(update.used) && update.used >= 0 && Number.isFinite(update.size) && update.size > 0) {
            state.document.usage = {used: update.used, size: update.size}
          }
          scheduleSave(state)
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
      state.settings = readSettings(connection.configOptions ?? [])
      state.document.sessionId = connection.sessionId
      state.document.cwd = state.subject.cwd
      await save(state)
      return connection
    })()
    state.connecting = pending
    try { return await pending } finally {
      if (state.connecting === pending) {
        delete state.connecting
        delete state.progress
        publish(state)
      }
    }
  }
  const run = async (state: State, content: Parameters<StorybookTechAcp.Output["prompt"]>[0], requestId: string): Promise<void> => {
    delete state.cursor.message
    let stopReason: string | undefined
    let interrupted = false
    let started = false
    try {
      if (state.cancelled || disposed) {
        interrupted = true
        return
      }
      const connection = await connect(state)
      if (state.cancelled || disposed) {
        interrupted = true
        return
      }
      state.document.status = "running"
      publish(state)
      const environment = state.environment
      const signature = environment === undefined ? undefined : createHash("sha256")
        .update(connection.sessionId).update("\0").update(JSON.stringify(environment.content)).digest("hex")
      const bootstrap = environment !== undefined && signature !== state.document.environmentContext
      let supplied = content
      if (bootstrap) {
        state.document.timeline.push({id: randomUUID(), sequence: nextSequence(state.document.timeline), origin: "local",
          kind: "context", content: structuredClone(environment.content), requestId})
        supplied = [...environment.content, ...(typeof content === "string" ? [{type: "text" as const, text: content}] : content)]
        publish(state)
      }
      await exclusive(state, async () => {
        const messageId = `user:${requestId}`
        const index = state.document.pending.indexOf(messageId)
        if (index === -1) throw new Error("Входящая задача уже начата или отсутствует")
        const markerId = randomUUID()
        state.document.pending.splice(index, 1)
        state.document.timeline.push({id: markerId, sequence: nextSequence(state.document.timeline), origin: "local", kind: "turn", requestId, state: "started"})
        try {
          await save(state)
          started = true
        } catch (error) {
          state.document.pending.splice(index, 0, messageId)
          state.document.timeline = state.document.timeline.filter(item => item.id !== markerId)
          throw error
        }
      })
      while (!state.cancelled && !disposed) {
        delete state.cursor.message
        const after = nextSequence(state.document.timeline)
        const result = await connection.prompt(supplied)
        if (signature !== undefined) state.document.environmentContext = signature
        stopReason = result.stopReason
        interrupted = state.cancelled || disposed || result.stopReason === "cancelled"
        if (interrupted || result.stopReason !== "end_turn" || environment === undefined) break
        const message = state.document.timeline.findLast(item => item.sequence >= after && item.kind === "message" && item.role === "assistant")
        const command = message?.kind === "message" ? readCommand(message.content) : null
        if (command === null || message?.kind !== "message") break
        state.document.timeline[state.document.timeline.indexOf(message)] = {...message, purpose: "command"}
        publish(state)
        // Сохраняем решение до исполнения: сбой никогда не повторяет возможную мутацию сам.
        await save(state)
        const resultContent = await environment.execute(command, state.turnController!.signal)
        state.document.timeline.push({id: randomUUID(), sequence: nextSequence(state.document.timeline), origin: "local",
          kind: "context", content: structuredClone(resultContent), requestId})
        supplied = [...resultContent]
        await save(state)
        publish(state)
      }
      interrupted ||= state.cancelled || disposed
    } catch (error) {
      state.document.historyComplete = false
      interrupted = state.cancelled || disposed
      state.document.status = interrupted ? "idle" : "failed"
      state.document.error = interrupted ? null : error instanceof Error ? error.message : String(error)
      const connection = state.connection
      delete state.connection
      await connection?.dispose().catch(() => {})
    } finally {
      clearPermissions(state)
      clearTimeout(state.flushTimer)
      delete state.flushTimer
      delete state.cursor.message
      if (!started && state.cancelled && !disposed) state.document.pending = state.document.pending.filter(id => id !== `user:${requestId}`)
      if (!started && state.document.status === "failed") state.retryBlocked = true
      if (state.document.status !== "failed") state.document.status = "idle"
      if (interrupted && state.document.status === "idle") {
        recordMessage(state.document.timeline, randomUUID(), "system", [{type: "text", text: "Выполнение остановлено."}])
      }
      state.document.timeline.push({id: randomUUID(), sequence: nextSequence(state.document.timeline), origin: "local", kind: "turn",
        requestId, state: state.document.status === "failed" ? "failed" : interrupted ? "cancelled" : "completed",
        ...(stopReason === undefined ? {} : {stopReason}),
        ...(state.document.error === null ? {} : {error: state.document.error}),
      })
      delete state.turn
      delete state.turnController
      try { await save(state) } catch (error) {
        state.document.status = "failed"
        state.document.error = `Не удалось сохранить историю: ${error instanceof Error ? error.message : String(error)}`
      }
      publish(state)
    }
  }
  /** Очередь хранит только ссылки; durable start отделён от ещё не начатых входящих задач. */
  const wake = (state: State): void => {
    if (disposed || state.draining !== undefined || state.retryBlocked || state.moveBlocked || !state.document.pending.length || relocating.has(state.key)) return
    const draining = (async () => {
      while (!disposed && !state.retryBlocked) {
        const selected = await exclusive(state, () => {
          if (disposed || state.moveBlocked || relocating.has(state.key) || state.turn !== undefined || state.configuring || state.connecting !== undefined) return undefined
          const messageId = state.document.pending[0]
          if (messageId === undefined) return undefined
          const requestId = messageId.slice(5)
          const content = queuedContent(state.document, messageId)
          state.cancelled = false
          if (state.lifetime.signal.aborted) state.lifetime = new AbortController()
          state.turnController = new AbortController()
          state.document.status = state.connection === undefined ? "connecting" : "running"
          state.document.error = null
          publish(state)
          const turn = run(state, content, requestId)
          state.turn = turn
          return {turn}
        })
        if (selected === undefined) break
        await selected.turn
      }
    })().catch(error => {
      state.retryBlocked = true
      state.document.status = "failed"
      state.document.error = error instanceof Error ? error.message : String(error)
      publish(state)
    }).finally(() => {
      if (state.draining === draining) delete state.draining
      if (!disposed && !state.retryBlocked && !state.moveBlocked && state.document.pending.length &&
        state.turn === undefined && !state.configuring && state.connecting === undefined && !relocating.has(state.key)) wake(state)
    })
    state.draining = draining
  }
  const deliver = async (target: Target, supplied: Parameters<StorybookTechAcp.Output["prompt"]>[0], requestedId: string, queued: boolean): Promise<Snapshot> => {
    const content = inputContent(supplied)
    const requestId = requestIdentity(requestedId)
    const state = await load(target)
    await exclusive(state, async () => {
      if (disposed) throw new Error("Чаты остановлены")
      if (relocating.has(state.key)) throw new Error("Беседа переносится на новый адрес")
      const id = `user:${requestId}`
      const previous = state.document.timeline.find(item => item.id === id && item.kind === "message" && item.role === "user")
      if (previous !== undefined) {
        if (previous.kind !== "message" || JSON.stringify(previous.content) !== JSON.stringify(content)) throw new Error("Идентификатор отправки уже использован для другого сообщения")
        return
      }
      if (!queued && (state.configuring || state.turn !== undefined || state.connecting !== undefined || state.document.pending.length)) {
        throw new Error("Дождитесь завершения текущего ответа")
      }
      recordMessage(state.document.timeline, id, "user", content)
      const contexts = content.filter(block => block.type === "resource" || block.type === "resource_link")
      if (contexts.length) state.document.timeline.push({id: randomUUID(), sequence: nextSequence(state.document.timeline), origin: "local", kind: "context", content: contexts, requestId})
      state.document.pending.push(id)
      if (!queued || !state.retryBlocked && state.turn === undefined && !state.configuring && state.connecting === undefined) {
        state.document.status = state.connection === undefined ? "connecting" : "running"
        state.document.error = null
      }
      publish(state)
      try { await save(state) } catch (error) {
        state.document.pending = state.document.pending.filter(item => item !== id)
        state.document.timeline = state.document.timeline.filter(item => item.id !== id && !("requestId" in item && item.requestId === requestId))
        state.document.status = "failed"
        state.document.error = `Не удалось сохранить сообщение: ${error instanceof Error ? error.message : String(error)}`
        publish(state)
        throw error
      }
    })
    wake(state)
    return snapshot(state)
  }
  return {
    async create({address, label}) {
      if (disposed) throw new Error("Чаты остановлены")
      if (typeof label !== "string" || label.trim().length === 0 || label.trim().length > 128) throw new TypeError("Имя исполнителя должно содержать от 1 до 128 символов")
      const subject = input.resolve(address)
      const executorId = randomUUID()
      const document: Document = {schemaVersion: 2, id: randomUUID(), executorId, executorLabel: label.trim(), address: subject.address,
        timeline: [], pending: [], historyComplete: true, status: "idle", error: null}
      const file = chatFile(input.directory(subject), subject.address, executorId)
      const key = targetKey(subject.address, executorId)
      const pending = (async () => {
        await copyHistory(file, document)
        return makeState(subject, file, document, false)
      })()
      states.set(key, pending)
      try { return snapshot(await pending) } catch (error) {
        if (states.get(key) === pending) states.delete(key)
        throw error
      }
    },
    async list(address) {
      if (disposed) throw new Error("Чаты остановлены")
      const subject = input.resolve(address)
      const selected = new Map<string, State>()
      for (const [key, pending] of states) {
        if (!key.startsWith(`[${JSON.stringify(subject.address)},`)) continue
        const state = await pending
        if (state.subject.address === subject.address && await movedSource(state.file, state.document) === null) {
          state.subject = subject
          selected.set(state.document.executorId, state)
        }
      }
      const directory = input.directory(subject)
      const defaultName = chatFile("", subject.address)
      const prefix = defaultName.slice(0, -5)
      const entries = await readdir(directory, {withFileTypes: true}).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        return []
      })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        if (entry.name === defaultName) {
          const document = await readChatDocument(join(directory, entry.name), subject.address)
          if (document === null || await movedSource(join(directory, entry.name), document) !== null) continue
          const state = await load(subject.address)
          selected.set(state.document.executorId, state)
        } else if (entry.name.startsWith(`${prefix}.`) && entry.name.endsWith(".json")) {
          const suffix = entry.name.slice(prefix.length + 1, -5)
          if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(suffix)) continue
          const document = await readChatDocument(join(directory, entry.name), subject.address)
          if (document === null || await movedSource(join(directory, entry.name), document) !== null) continue
          const state = await load({address: subject.address, executorId: suffix})
          selected.set(state.document.executorId, state)
        }
      }
      if (![...selected.values()].some(state => state.isDefault) && input.legacyDirectory !== undefined) {
        const legacy = await readChatDocument(chatFile(input.legacyDirectory, subject.address), subject.address)
        if (legacy !== null && await movedSource(chatFile(directory, subject.address), legacy) === null) {
          const state = await load(subject.address)
          selected.set(state.document.executorId, state)
        }
      }
      return [...selected.values()].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.document.executorId.localeCompare(b.document.executorId)).map(state => {
        wake(state)
        return snapshot(state)
      })
    },
    async migrateLegacy() {
      if (disposed) throw new Error("Чаты остановлены")
      if (input.legacyDirectory === undefined) return {migrated: 0, unresolved: []}
      const files = await readdir(input.legacyDirectory, {withFileTypes: true}).catch(error => {
        if (error.code !== "ENOENT") throw error
        return []
      })
      let migrated = 0
      const unresolved: string[] = []
      for (const entry of files) {
        if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) continue
        const file = join(input.legacyDirectory, entry.name)
        const raw: unknown = JSON.parse(await readFile(file, "utf8"))
        const address = raw !== null && typeof raw === "object" && "address" in raw ? raw.address : undefined
        const document = typeof address === "string" ? decodeDocument(raw, address) : null
        if (typeof address !== "string" || document === null || chatFile(input.legacyDirectory, address) !== file) {
          throw new Error("Повреждена прежняя история чата")
        }
        let subject: Subject
        try { subject = input.resolve(address) } catch {
          unresolved.push(address)
          continue
        }
        const target = chatFile(input.directory(subject), address)
        if (target === file || await readChatDocument(target, address) !== null || await movedSource(target, document) !== null) continue
        await copyHistory(target, document)
        migrated += 1
      }
      return {migrated, unresolved}
    },
    async read(target) { return snapshot(await load(target)) },
    async prepare(target) {
      const state = await load(target)
      if (state.connection !== undefined) return snapshot(state)
      if (state.turn !== undefined) throw new Error("Дождитесь завершения текущего ответа")
      if (state.lifetime.signal.aborted) state.lifetime = new AbortController()
      state.cancelled = false
      state.configuring = true
      publish(state)
      try { await connect(state)
        state.retryBlocked = false } finally {
        state.configuring = false
        publish(state)
        wake(state)
      }
      return snapshot(state)
    },
    async configure(target, id, value) {
      const state = await load(target)
      if (state.turn !== undefined || state.configuring) throw new Error("Дождитесь завершения текущей операции чата")
      const option = state.settings?.find(item => item.id === id)
      if (!option || !option.options.some(item => item.value === value)) throw new Error("Выберите доступный вариант настройки")
      if (state.lifetime.signal.aborted) state.lifetime = new AbortController()
      state.cancelled = false
      state.configuring = true
      publish(state)
      try {
        const connection = await connect(state)
        const previousUsage = state.document.usage
        state.settings = readSettings(await connection.setConfigOption(id, value))
        if (option.category === "model" && value !== option.value && state.document.usage === previousUsage) delete state.document.usage
        await save(state)
      } finally {
        state.configuring = false
        publish(state)
        wake(state)
      }
      return snapshot(state)
    },
    async prompt(target, content, requestId) { return await deliver(target, content, requestId, false) },
    async enqueue(target, content, requestId) { return await deliver(target, content, requestId, true) },
    async cancel(target) {
      const state = await load(target)
      if (state.turn === undefined && !state.connecting && state.document.status !== "connecting" && state.document.status !== "running") return snapshot(state)
      state.cancelled = true
      state.turnController?.abort(new Error("Выполнение отменено"))
      clearPermissions(state)
      if (state.connection === undefined) state.lifetime.abort(new Error("Подключение отменено"))
      await state.connection?.cancel()
      publish(state)
      return snapshot(state)
    },
    async permission(target, id, optionId) {
      const state = await load(target)
      const pending = state.permissions.get(id)
      if (pending === undefined || !pending.value.options.some(option => option.id === optionId)) throw new Error("Запрос разрешения или вариант больше не доступен")
      state.permissions.delete(id)
      pending.resolve({outcome: {outcome: "selected", optionId}})
      publish(state)
      return snapshot(state)
    },
    async subscribe(target, listener) {
      const state = await load(target)
      if (relocating.has(state.key)) throw new Error("Беседа переносится на новый адрес")
      state.listeners.add(listener)
      listener(snapshot(state))
      return () => { state.listeners.delete(listener) }
    },
    async relocate({from, to, executorId: selectedId}) {
      if (disposed) throw new Error("Чаты остановлены")
      if (typeof from?.address !== "string" || typeof to?.address !== "string" ||
        !from.address.startsWith("/") || !to.address.startsWith("/") || /[?#]/u.test(from.address) || /[?#]/u.test(to.address) ||
        from.address === to.address || typeof from.cwd !== "string" || typeof to.cwd !== "string" || !isAbsolute(from.cwd) || !isAbsolute(to.cwd)) {
        throw new TypeError("Нужно точное соответствие прежнего и нового адреса и cwd")
      }
      const executorId = selectedId === undefined ? undefined : executorIdentity(selectedId)
      const held = new Set<string>()
      const hold = (...keys: string[]) => {
        if (keys.some(key => relocating.has(key) && !held.has(key))) throw new Error("Беседа уже переносится")
        for (const key of keys) {
          relocating.add(key)
          held.add(key)
        }
      }
      hold(targetKey(from.address, executorId), targetKey(to.address, executorId))
      let result: State | undefined
      try {
        const subject = input.resolve(to.address)
        if (subject.address !== to.address || subject.cwd !== to.cwd) throw new Error("Новый адрес и cwd не совпадают с текущим каталогом")
        const current = await loaded(from.address, executorId)
        await current?.mutations
        let isDefault = current?.isDefault ?? executorId === undefined
        let oldFile = chatFile(input.directory(from), from.address, isDefault ? undefined : executorId)
        let source = await readChatDocument(oldFile, from.address)
        if (source === null && executorId !== undefined && current === undefined) {
          oldFile = chatFile(input.directory(from), from.address)
          source = await readChatDocument(oldFile, from.address)
            ?? (input.legacyDirectory === undefined ? null : await readChatDocument(chatFile(input.legacyDirectory, from.address), from.address))
          if (source?.executorId !== executorId) return null
          isDefault = true
        } else if (source === null && isDefault && input.legacyDirectory !== undefined) {
          source = await readChatDocument(chatFile(input.legacyDirectory, from.address), from.address)
        }
        if (source === null) return null
        if (current !== undefined && (current.id !== source.id || current.document.address !== from.address)) throw new Error("Загруженная беседа не совпадает с сохранённой историей")
        if (current !== undefined) source.executorId = current.document.executorId
        if (executorId !== undefined && source.executorId !== executorId) throw new Error("История принадлежит другому исполнителю")
        if (source.cwd !== undefined && source.cwd !== from.cwd) throw new Error("Сохранённый cwd не совпадает с прежним владельцем беседы")
        const sourceKey = targetKey(from.address, isDefault ? undefined : source.executorId)
        const destinationKey = targetKey(to.address, isDefault ? undefined : source.executorId)
        hold(sourceKey, destinationKey)
        const newFile = chatFile(input.directory(to), to.address, isDefault ? undefined : source.executorId)
        const existing = await loaded(to.address, isDefault ? undefined : source.executorId)
        await existing?.mutations
        const destination = await readChatDocument(newFile, to.address)
        if (destination !== null && (destination.id !== source.id || destination.executorId !== source.executorId ||
          destination.cwd !== undefined && destination.cwd !== to.cwd)) throw new Error("Новый адрес уже занят другой беседой")
        if (existing !== undefined && (existing.id !== source.id || existing.document.executorId !== source.executorId || existing.isDefault !== isDefault)) {
          throw new Error("Новый адрес уже занят другой беседой")
        }
        if (destination !== null && await movedSource(newFile, destination) !== null) throw new Error("Беседа назначения уже перенесена дальше")
        const intent = {schemaVersion: 1 as const, id: source.id, executorId: source.executorId, from, to}
        const previous = await readMoveIntent(oldFile)
        if (previous !== null && !sameMove(previous, intent)) throw new Error("Беседа уже переносится по другому соответствию")
        if (previous === null && (current?.turn !== undefined || current?.connecting !== undefined || current?.configuring || current?.permissions.size ||
          current?.document.status === "connecting" || current?.document.status === "running" ||
          existing?.turn !== undefined || existing?.connecting !== undefined || existing?.configuring || existing?.document.status === "connecting" || existing?.document.status === "running")) {
          throw new Error("Активную беседу нельзя переносить до завершения turn")
        }
        await current?.write
        if (current !== undefined) {
          await current.connection?.dispose()
          delete current.connection
          current.environment?.dispose()
          delete current.environment
          if (current.flushTimer !== undefined) {
            clearTimeout(current.flushTimer)
            delete current.flushTimer
            await save(current)
            source = await readChatDocument(oldFile, from.address) ?? source
          }
        }
        // Source закрывается durable intent ДО появления второй копии этой identity.
        await writeMoveIntent(oldFile, intent)
        if (current !== undefined) current.moveBlocked = true
        let document: Document
        try {
          document = destination ?? await copyHistory(newFile, {...source, address: to.address,
            ...(source.cwd === undefined ? {} : {cwd: to.cwd})})
        } catch (error) {
          throw new Error("Перенос ожидает завершения; исходная история сохранена. Повторите то же соответствие адресов.", {cause: error})
        }
        if (document.executorId !== source.executorId) throw new Error("Identity назначения не совпадает с исполнителем")
        if (current !== undefined && existing === undefined) {
          states.delete(current.key)
          current.key = destinationKey
          current.subject = subject
          current.file = newFile
          current.document = document
          current.moveBlocked = false
          current.retryBlocked = false
          states.set(destinationKey, Promise.resolve(current))
          publish(current)
          result = current
        } else {
          if (current !== undefined && existing !== undefined) {
            states.delete(current.key)
            for (const listener of current.listeners) existing.listeners.add(listener)
            current.listeners = existing.listeners
            existing.version = Math.max(existing.version, current.version)
            publish(existing)
          }
          if (existing !== undefined) {
            existing.subject = subject
            result = existing
          } else {
            result = makeState(subject, newFile, document, isDefault)
            states.set(destinationKey, Promise.resolve(result))
          }
        }
      } finally {
        for (const key of held) relocating.delete(key)
        if (result !== undefined) wake(result)
      }
      return result === undefined ? null : snapshot(result)
    },
    async dispose() {
      if (disposed) return
      disposed = true
      const results = await Promise.allSettled([...states.values()].map(async pending => {
        const state = await pending.catch(() => undefined)
        if (state === undefined) return
          state.cancelled = true
        state.turnController?.abort(new Error("Сервер чатов останавливается"))
        state.lifetime.abort(new Error("Сервер чатов останавливается"))
        clearPermissions(state)
        try {
          await state.mutations
          await state.connecting?.catch(() => {})
          await state.connection?.dispose()
        } finally {
          await state.turn
          await state.draining
          if (state.flushTimer !== undefined) {
            clearTimeout(state.flushTimer)
            delete state.flushTimer
            await save(state)
          }
          await state.write
          state.listeners.clear()
          state.environment?.dispose()
        }
      }))
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected")
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Не все чаты удалось освободить")
    },
  }
}
