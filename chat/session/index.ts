/**
Ведёт независимые беседы исполнителей одного Project. Полная история хранится на диске,
управляющие снимки содержат только состояние и счётчики. Заголовки, тела и исходные
свидетельства читаются отдельными ограниченными запросами без подключения ACP.
Отписка сохраняет работу; неактивные подключения освобождаются с сохранением sessionId.

@packageDocumentation
*/
import {createHash, randomUUID} from "node:crypto"
import {AsyncLocalStorage} from "node:async_hooks"
import {readdir, readFile} from "node:fs/promises"
import {basename, dirname, isAbsolute, join} from "node:path"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"
import type {StorybookChatSession} from "./contract"
import type {Permission, Snapshot, Subject, Setting} from "./contract/state"
import type {Environment} from "./contract/environment"
import type {Target} from "./contract/target"
import type {ExecutionResolution, ExecutionSelection, ExecutionSource} from "./contract/execution"

import type {Archive, ArchiveMetadata, ArchiveCursor} from "./src/archive"
import {openArchive, readArchiveMetadata, readArchiveState} from "./src/archive"
type Document = ArchiveMetadata & {schemaVersion: 3}

import {chatFile, copyHistory, readChatDocument, importLegacy} from "./src/storage"
import {softDelete, readTrash, restoreTrash, purgeTrash} from "./src/trash"
import {readSettings} from "./src/settings"
import readCommand from "./src/command"
import {executorIdentity, targetParts, targetKey} from "./src/target"
import {defaultExecutorId} from "./src/identity"
import {requestIdentity} from "./src/queue"
import {movedSource, readMoveIntent, sameMove, writeMoveIntent} from "./src/relocation"
import {inputContent} from "./src/timeline"
import {ownerCwd} from "./src/document"

export type {StorybookChatSession} from "./contract"
export type {HistoryGroup, HistoryOccurrence, HistoryContentPage, HistoryContentCursor, HistoryDetailPage, HistoryTerminalPage, HistoryTerminalCursor} from "./contract/history"
export {createMediaStore, isMediaReference, projectMedia} from "./src/media"
export {fetchExternalImage} from "./src/external-media"
export {collectMedia} from "./src/media-gc"
export type {MediaCollectionOptions, MediaCollectionResult} from "./src/media-gc"

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
  archive: Archive
  accessed: number
  leases: number
  idleTimer?: ReturnType<typeof setTimeout>
  releaseSlot?: () => void
  version: number
  connection?: StorybookTechAcp.Output
  environment?: Environment
  connecting?: Promise<StorybookTechAcp.Output>
  settings?: readonly Setting[]
  execution?: ExecutionResolution
  configuring?: boolean
  progress?: string
  turn?: Promise<void>
  turnController?: AbortController
  cancelled: boolean
  approvalMode?: "ask" | "scoped-autonomous"
  approvalPolicyRevision?: number
  cursor: ArchiveCursor
  lifetime: AbortController
  flushTimer?: ReturnType<typeof setTimeout>
  publishTimer?: ReturnType<typeof setTimeout>
  listeners: Set<(value: Snapshot) => void>
  permissions: Map<string, {value: Permission, cancelled?: boolean, resolve: (value: Awaited<ReturnType<StorybookTechAcp.Input["onPermission"]>>) => void}>
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
  const access = new AsyncLocalStorage<Set<State>>()
  const lease = (state: State): State => {
    const held = access.getStore()
    if (held !== undefined && !held.has(state)) {
      held.add(state)
      state.leases += 1
    }
    return state
  }
  const limit = (value: number | undefined, fallback: number): number => value === undefined ? fallback : Number.isInteger(value) && value > 0 ? value : (() => { throw new TypeError("Лимит должен быть положительным целым") })()
  const maxInactive = limit(input.maxInactiveSessions, 32)
  const maxPending = limit(input.maxPending, 128)
  const maxConnections = limit(input.maxConnections, 4)
  const idleMs = limit(input.idleConnectionMs, 30_000)
  let connections = 0
  const slotWaiters: (() => void)[] = []
  const acquireSlot = async (state: State): Promise<void> => {
    while (connections >= maxConnections) {
      for (const pending of states.values()) {
        const other = await pending.catch(() => undefined)
        if (other !== undefined && other !== state && !busy(other) && other.connection !== undefined) {
          await exclusive(other, () => releaseConnection(other))
          break
        }
      }
      if (connections < maxConnections) break
      if (state.cancelled || disposed) throw new Error("Подключение отменено")
      await new Promise<void>(resolve => {
        const wake = () => {
          state.lifetime.signal.removeEventListener("abort", wake)
          const index = slotWaiters.indexOf(wake)
          if (index !== -1) slotWaiters.splice(index, 1)
          resolve()
        }
        slotWaiters.push(wake)
        state.lifetime.signal.addEventListener("abort", wake, {once: true})
      })
    }
    if (state.cancelled || disposed) throw new Error("Подключение отменено")
    connections += 1
    state.releaseSlot = () => {
      delete state.releaseSlot
      connections -= 1
      slotWaiters.shift()?.()
    }
  }
  const busy = (state: State): boolean => state.turn !== undefined || state.draining !== undefined || state.connecting !== undefined || state.configuring === true || state.document.pending.length > 0 || state.permissions.size > 0
  const releaseConnection = async (state: State, releaseEnvironment = true): Promise<void> => {
    clearTimeout(state.idleTimer)
    delete state.idleTimer
    const connection = state.connection
    delete state.connection
    try { await connection?.dispose() } finally {
      if (releaseEnvironment) {
        state.environment?.dispose()
        delete state.environment
      }
      state.releaseSlot?.()
    }
  }
  const idle = (state: State): void => {
    state.accessed = Date.now()
    if (busy(state) || state.connection === undefined && state.environment === undefined || state.idleTimer !== undefined) return
    state.idleTimer = setTimeout(() => {
      delete state.idleTimer
      if (!busy(state)) void exclusive(state, () => releaseConnection(state)).then(() => trim()).catch(() => {})
    }, idleMs)
    state.idleTimer.unref?.()
  }
  let trimming = Promise.resolve()
  const trim = (): Promise<void> => {
    trimming = trimming.catch(() => {}).then(async () => {
      const inactive = (await Promise.all([...states.values()].map(pending => pending.catch(() => undefined))))
        .filter((state): state is State => state !== undefined && !busy(state) && state.listeners.size === 0 && state.leases === 0)
        .sort((a, b) => a.accessed - b.accessed)
      for (const state of inactive.slice(0, Math.max(0, inactive.length - maxInactive))) {
        if (busy(state) || state.listeners.size || state.leases) continue
        if (states.get(state.key) === undefined) continue
        await exclusive(state, async () => {
          await releaseConnection(state)
          clearPublication(state)
          if (state.flushTimer !== undefined) {
            clearTimeout(state.flushTimer)
            delete state.flushTimer
            await save(state)
          }
          await state.write
          if (state.archive.exists) await save(state)
          await state.archive.dispose()
          states.delete(state.key)
        })
      }
    })
    return trimming
  }
  const projectExecution = (state: Pick<State, "document" | "settings" | "execution">, resolved: ExecutionResolution): ExecutionResolution => {
    const effective = {...resolved.effective}
    const sources = {...resolved.sources}
    const preserve = state.document.preserveNativeSettings === true || state.document.sessionId !== undefined && state.document.connectionId === undefined
    for (const [field, category] of [["model", "model"], ["thoughtLevel", "thought_level"]] as const) {
      if (sources[field] === "native") delete effective[field]
      if (preserve && sources[field] !== "executor" && sources[field] !== "session") {
        delete effective[field]
        delete sources[field]
      }
      if (effective[field] === undefined) {
        const baseline = state.document.executionBaseline
        const native = field === "model" ? baseline?.model ?? state.settings?.find(option => option.category === category)?.value
          : effective.model === baseline?.model && baseline?.thoughtLevel !== undefined ? baseline.thoughtLevel : state.settings?.find(option => option.category === category)?.value
        if (native !== undefined) {
          effective[field] = native
          sources[field] = "native"
        }
      }
    }
    return state.execution = {...resolved, effective, sources}
  }
  const refreshExecution = async (state: Pick<State, "document" | "subject" | "settings" | "execution">, executorSelection?: ExecutionSelection): Promise<ExecutionResolution> => {
    const selection = state.document.executionSelection ?? {}
    const pinnedConnectionId = state.document.sessionId === undefined ? undefined : state.document.connectionId ?? "codex"
    const resolved = await input.resolveExecution?.({subject: state.subject, executorId: state.document.executorId, sessionId: state.document.id, selection,
      ...(executorSelection === undefined ? {} : {executorSelection}),
      ...(pinnedConnectionId === undefined ? {} : {pinnedConnectionId})}) ?? {
      selection, executorSelection: {}, effective: {connectionId: pinnedConnectionId ?? selection.connectionId ?? "codex", ...Object.fromEntries(Object.entries(selection).filter(([key]) => key !== "approvalMode"))},
      sources: {connectionId: (selection.connectionId === undefined ? pinnedConnectionId === undefined ? "general" : "native" : "session") as ExecutionSource,
        ...(selection.model === undefined ? {} : {model: "session" as const}), ...(selection.thoughtLevel === undefined ? {} : {thoughtLevel: "session" as const})},
      connections: [{id: "codex", provider: "codex" as const, label: "Codex", enabled: true}],
    }
    return projectExecution(state, resolved)
  }
  const applyExecution = async (state: State, connection: StorybookTechAcp.Output, resolved?: ExecutionResolution, document = state.document): Promise<void> => {
    const current = resolved ?? await refreshExecution(state)
    const nativeMode = state.settings?.find(option => option.category === "mode")
    if (nativeMode !== undefined && nativeMode.value !== "read-only") {
      if (!nativeMode.options.some(option => option.value === "read-only")) throw new Error("Исполнитель не предоставляет ограниченный native режим")
      state.settings = readSettings(await connection.setConfigOption(nativeMode.id, "read-only"))
      if (state.settings.find(option => option.id === nativeMode.id)?.value !== "read-only") throw new Error("Исполнитель не подтвердил ограниченный native режим")
    }
    for (const [field, category] of [["model", "model"], ["thoughtLevel", "thought_level"]] as const) {
      const execution = projectExecution({document, settings: state.settings ?? []}, current)
      const selected = execution.effective[field]
      if (selected === undefined) continue
      const option = state.settings?.find(item => item.category === category)
      if (!option || !option.options.some(item => item.value === selected)) throw new Error(`Выбранная настройка ${category} «${selected}» недоступна в подключении ${execution.effective.connectionId}`)
      if (option.value !== selected) {
        state.settings = readSettings(await connection.setConfigOption(option.id, selected))
        if (category === "model") delete state.document.usage
      }
    }
    state.execution = projectExecution({document, settings: state.settings ?? []}, current)
  }
  const snapshot = (state: Pick<State, "id" | "document" | "subject" | "version" | "permissions" | "connection" | "progress" | "settings" | "configuring" | "execution"> & {archive: Pick<Archive, "stats" | "displayStats">}): Snapshot => structuredClone({
    id: state.id, sessionId: state.id, sessionLabel: state.document.sessionLabel ?? "Новая беседа", executorId: state.document.executorId, executorLabel: state.document.executorLabel, pending: state.document.pending, address: state.subject.address, label: state.subject.label,
    history: state.archive.stats(), displayHistory: state.archive.displayStats(), capabilities: state.connection?.capabilities ?? null, status: state.document.status,
    error: state.document.error, permissions: [...state.permissions.values()].map(item => item.value),
    version: state.version,
    ...(state.progress === undefined ? {} : {progress: state.progress}),
    settings: state.settings ?? [], configuring: state.configuring === true, usage: state.document.usage ?? null,
    ...(state.execution === undefined ? {} : {execution: state.execution}),
    activity: state.document.status === "running" && "cancelled" in state && state.cancelled ? "cancelling"
      : state.permissions.size > 0 ? "waiting_for_approval" : state.document.status === "failed" && state.document.activeRequest !== undefined
        ? "recovery_required" : "responding",
  })
  const clearPublication = (state: State): void => {
    clearTimeout(state.publishTimer)
    delete state.publishTimer
  }
  const emit = (state: State): void => {
    if (disposed || state.listeners.size === 0) return
    const value = snapshot(state)
    for (const listener of state.listeners) {
      try { listener(value) } catch { /* Отказ одного наблюдателя не отменяет turn. */ }
    }
  }
  const publish = (state: State, streaming = false): void => {
    state.version += 1
    state.document.controlVersion = state.version
    if (disposed || state.listeners.size === 0) {
      clearPublication(state)
      return
    }
    if (streaming) {
      if (state.publishTimer === undefined) state.publishTimer = setTimeout(() => {
        delete state.publishTimer
        emit(state)
      }, 50)
      return
    }
    clearPublication(state)
    emit(state)
  }
  const save = (state: State): Promise<void> => {
    if (state.document.cwd !== undefined) state.document.cwd = ownerCwd(state.document.cwd)
    const {schemaVersion, ...current} = state.document
    const metadata = structuredClone(current)
    state.write = state.write.catch(() => {}).then(() => state.archive.commit(metadata))
    return state.write
  }
  const append = async (state: State, item: Parameters<Archive["commit"]>[1] extends readonly (infer T)[] | undefined ? T extends {type: "append", item: infer I} ? I : never : never): Promise<void> => {
    await state.archive.commit(undefined, [{type: "append", item}])
  }
  const receive = async (state: State, update: Parameters<Archive["receive"]>[0], origin: "live" | "replay" | "local"): Promise<void> => {
    await state.archive.receive(update, origin, state.cursor)
    scheduleSave(state)
    publish(state, true)
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
  const makeState = async (subject: Subject, file: string, document: Document, isDefault: boolean): Promise<State> => {
    const previousCwd = document.cwd
    if (previousCwd !== undefined) document.cwd = ownerCwd(previousCwd)
    const {schemaVersion, ...metadata} = document
    const archive = await openArchive(file, metadata)
    if (previousCwd !== document.cwd) await archive.commit(metadata)
    const state: State = {
      key: targetKey(subject.address, isDefault ? undefined : document.executorId, basename(file).endsWith(`.${document.executorId}.${document.id}.json`) ? document.id : undefined), isDefault,
      mutations: Promise.resolve(), retryBlocked: false, moveBlocked: false, subject, id: document.id, file, document,
      archive, accessed: Date.now(), leases: 0, version: document.controlVersion ?? 0, cancelled: false, cursor: {}, lifetime: new AbortController(),
      listeners: new Set(), permissions: new Map(), write: Promise.resolve(),
    }
    await refreshExecution(state)
    for (const id of document.pendingPermissions ?? []) {
      const request = archive.lookup(`permission:${id}:request`) === null ? null : archive.body(`permission:${id}:request`).entry
      if (request?.kind === "permission" && archive.lookup(`permission:${id}:decision`) === null) {
        const {request: _request, sequence: _sequence, ...entry} = request
        await append(state, {...entry, id: `permission:${id}:decision`, phase: "interrupted"})
      }
    }
    if (document.pendingPermissions?.length) { document.pendingPermissions = []; await save(state) }
    if (document.status === "connecting" || document.status === "running") {
      document.historyComplete = false
      document.status = "failed"
      document.error = "Предыдущее выполнение прервано остановкой сервера. Сообщение автоматически не повторялось."
      // Durable start не возвращает задачу в очередь после остановки процесса.
      if (document.activeRequest !== undefined) {
        await append(state, {id: randomUUID(), origin: "local", kind: "turn", requestId: document.activeRequest, state: "failed", error: document.error})
        delete document.activeRequest
      }
      await save(state)
    }
    return state
  }
  const emptyDefault = (subject: Subject): Document => {
    const directory = input.directory(subject)
    const id = createHash("sha256").update(input.legacyDirectory ?? directory).update("\0").update(subject.address).digest("hex")
    return {schemaVersion: 3, id, executorId: defaultExecutorId(id), executorLabel: "Основной", address: subject.address,
      pending: [], historyComplete: true, status: "idle", error: null}
  }
  const loaded = async (address: string, executorId?: string, sessionId?: string): Promise<State | undefined> => {
    if (executorId === undefined && sessionId === undefined) return await states.get(targetKey(address))
    for (const [key, pending] of states) {
      if (!key.startsWith(`[${JSON.stringify(address)},`)) continue
      const state = await pending.catch(() => undefined)
      if (state !== undefined && state.subject.address === address && state.document.executorId === executorId && (sessionId === undefined ? !basename(state.file).endsWith(`.${executorId}.${state.id}.json`) : state.id === sessionId)) return state
    }
    return undefined
  }
  const deletedMetadata = async (file: string): Promise<ArchiveMetadata | null> => (await readTrash(file))?.metadata ?? null
  const sessionRecords = async (subject: Subject): Promise<{file: string, document: Document, isDefault: boolean, deleted: boolean}[]> => {
    const directory = input.directory(subject)
    const main = chatFile(directory, subject.address)
    const prefix = basename(main).slice(0, -5)
    const entries = await readdir(directory, {withFileTypes: true}).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return []
    })
    const records: {file: string, document: Document, isDefault: boolean, deleted: boolean}[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith(".json") && !entry.name.endsWith(".json.deleted")) continue
      const deleted = entry.name.endsWith(".deleted")
      const file = join(directory, deleted ? entry.name.slice(0, -8) : entry.name)
      // Durable tombstone имеет приоритет, даже если процесс остановился до unlink корпуса.
      if (!deleted && await deletedMetadata(file) !== null) continue
      const metadata = deleted ? await deletedMetadata(file) : await readChatDocument(file, subject.address)
      if (metadata === null || metadata.address !== subject.address || !deleted && await movedSource(file, metadata) !== null) continue
      records.push({file, document: {...metadata, schemaVersion: 3}, isDefault: file === main, deleted})
    }
    return records.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.file.localeCompare(b.file))
  }
  const load = async (target: Target): Promise<State> => {
    if (disposed) throw new Error("Чаты остановлены")
    const {address, executorId, sessionId} = targetParts(target)
    const subject = input.resolve(address)
    const requested = targetKey(subject.address, executorId, sessionId)
    if (relocating.has(requested)) throw new Error("Беседа переносится на новый адрес")
    let current = await loaded(subject.address, executorId, sessionId)
    if (current !== undefined) {
      if (await deletedMetadata(current.file) !== null) throw new Error("Сессия удалена")
      if (relocating.has(current.key)) throw new Error("Беседа переносится на новый адрес")
      const move = await movedSource(current.file, current.document)
      if (move !== null) {
        current.moveBlocked = true
        throw new Error(`Беседа перенесена или ожидает завершения переноса на ${move.to.address}`)
      }
      current.subject = subject
      await refreshExecution(current)
      current.accessed = Date.now()
      idle(current)
      if (current.document.pending.length) wake(current)
      return lease(current)
    }
    let isDefault = executorId === undefined
    let file = chatFile(input.directory(subject), subject.address, executorId)
    let prepared: Document | null | undefined
    if (sessionId === undefined && await deletedMetadata(file) !== null) {
      const records = await sessionRecords(subject)
      const deleted = await deletedMetadata(file)
      const live = records.find(record => !record.deleted && record.document.executorId === (executorId ?? deleted?.executorId))
      if (live === undefined) throw new Error("У агента нет сессий; создайте новую")
      file = live.file
      isDefault = false
      prepared = live.document
    }
    if (executorId !== undefined) {
      if (sessionId !== undefined) {
        const records = await sessionRecords(subject)
        const exact = records.find(record => record.document.executorId === executorId && record.document.id === sessionId && !record.deleted)
        if (exact === undefined) throw new Error("Сессия не найдена у выбранного агента")
        file = exact.file
        isDefault = exact.isDefault
      }
      prepared ??= await readChatDocument(file, subject.address)
      if (prepared === null && sessionId !== undefined) throw new Error("Сессия не найдена у выбранного агента")
      if (prepared === null) {
        const defaultFile = chatFile(input.directory(subject), subject.address)
        const defaultDocument = await readChatDocument(defaultFile, subject.address)
          ?? (input.legacyDirectory === undefined ? null : await importLegacy(chatFile(input.legacyDirectory, subject.address), chatFile(input.directory(subject), subject.address), subject.address))
          ?? emptyDefault(subject)
        if (defaultDocument.executorId !== executorId) throw new Error("Исполнитель не найден у выбранного предмета")
        isDefault = true
        file = defaultFile
        prepared = defaultDocument
      }
      if (prepared.executorId !== executorId) throw new Error("Identity файла не совпадает с выбранным исполнителем")
    }
    const fileParts = basename(file).split(".")
    const key = targetKey(subject.address, isDefault ? undefined : executorId ?? prepared?.executorId, fileParts.length === 4 ? fileParts[2] : undefined)
    if (relocating.has(key)) throw new Error("Беседа переносится на новый адрес")
    let pending = states.get(key)
    if (pending === undefined) {
      pending = (async () => {
        let document = emptyDefault(subject)
        let value = prepared ?? await readChatDocument(file, subject.address)
        if (value === null && isDefault && input.legacyDirectory !== undefined) {
          const legacy = await importLegacy(chatFile(input.legacyDirectory, subject.address), chatFile(input.directory(subject), subject.address), subject.address)
          if (legacy !== null) {
            const move = await movedSource(file, legacy)
            if (move !== null) throw new Error(`Беседа перенесена или ожидает завершения переноса на ${move.to.address}`)
            value = legacy
          }
        }
        if (value !== null) document = value
        const move = await movedSource(file, document)
        if (move !== null) throw new Error(`Беседа перенесена или ожидает завершения переноса на ${move.to.address}`)
        if (!isDefault && executorId !== undefined && document.executorId !== executorId) throw new Error("Identity файла не совпадает с выбранным исполнителем")
        return await makeState(subject, file, document, isDefault)
      })()
      states.set(key, pending)
      void pending.catch(() => { if (states.get(key) === pending) states.delete(key) })
    }
    current = await pending
    current.subject = subject
    await refreshExecution(current)
    current.accessed = Date.now()
    idle(current)
    if (current.document.pending.length) wake(current)
    return lease(current)
  }
  /** Списки раскрывают idle header без writer; accepted pending использует единственный canonical load. */
  const summarize = async (subject: Subject, file: string, document: Document, deleted = false): Promise<Snapshot> => {
    if (!deleted) {
      const resident = await loaded(subject.address, document.executorId, document.id)
      if (resident !== undefined) {
        lease(resident)
        if (await deletedMetadata(resident.file) !== null) throw new Error("Сессия удалена")
        await resident.archive.flush()
        await refreshExecution(resident)
        return snapshot(resident)
      }
      if (document.pending.length || document.activeRequest !== undefined || document.status === "connecting" || document.status === "running") {
        const state = await load({address: subject.address, executorId: document.executorId, sessionId: document.id})
        await state.archive.flush()
        return snapshot(state)
      }
    }
    const saved = deleted ? null : await readArchiveState(file)
    if (saved !== null) {
      const current = {...saved.metadata, schemaVersion: 3 as const}
      return snapshot({id: current.id, document: current, subject, archive: {stats: () => saved.history, displayStats: () => saved.displayHistory ?? saved.history},
        version: current.controlVersion ?? 0, permissions: new Map(),
        execution: await refreshExecution({document: current, subject}),
      })
    }
    const {schemaVersion, ...metadata} = document
    const archive = await openArchive(file, metadata)
    try {
      return snapshot({id: document.id, document, subject, archive,
        version: document.controlVersion ?? 0, permissions: new Map(),
        execution: await refreshExecution({document, subject}),
      })
    } finally { await archive.dispose() }
  }
  type PermissionResponse = Awaited<ReturnType<StorybookTechAcp.Input["onPermission"]>>
  const finishPermission = async (state: State, id: string, response: PermissionResponse, actor: "user" | "policy" = "user", hash?: string): Promise<void> => {
    await exclusive(state, async () => {
      const previousId = state.archive.lookup(`permission:${id}:dispatch-cancelled`) === null ? `permission:${id}:decision` : `permission:${id}:dispatch-cancelled`
      const previous = state.archive.lookup(previousId) === null ? null : state.archive.body(previousId).entry
      if (previous?.kind === "permission") {
        if (hash !== undefined && previous.requestHash !== hash) throw new Error("Запрос разрешения изменился")
        if (response.outcome.outcome === "selected" && previous.phase === "decided" && previous.optionId === response.outcome.optionId) return
        if (response.outcome.outcome === "cancelled" && previous.phase !== "decided") return
        throw new Error("По запросу уже принято другое решение")
      }
      const pending = state.permissions.get(id)
      if (!pending) throw new Error("Запрос разрешения больше не доступен")
      const request = pending.value
      if (hash !== undefined && hash !== request.requestHash) throw new Error("Запрос разрешения изменился")
      const outcome = response.outcome
      if (outcome.outcome === "selected" && (state.cancelled || pending.cancelled || !request.options.some(option => option.id === outcome.optionId))) throw new Error("Вариант разрешения больше не доступен")
      const remaining = (state.document.pendingPermissions ?? []).filter(value => value !== id)
      const previousPending = state.document.pendingPermissions
      state.document.pendingPermissions = remaining
      const {schemaVersion, ...metadata} = state.document
      state.write = state.write.catch(() => {}).then(() => state.archive.commit(structuredClone(metadata), [{type: "append", item: {
        id: `permission:${id}:decision`, origin: "local", kind: "permission", permissionId: id,
        requestId: state.document.activeRequest ?? "preparation", requestHash: request.requestHash!,
        source: request.source!, phase: response.outcome.outcome === "selected" ? "decided" : "cancelled",
        title: request.title, actor,
        ...(response.outcome.outcome === "selected" ? {optionId: response.outcome.optionId} : {}),
      }}]))
      try { await state.write } catch (error) {
        if (previousPending === undefined) delete state.document.pendingPermissions
        else state.document.pendingPermissions = previousPending
        throw error
      }
      let delivered = response
      if (response.outcome.outcome === "selected" && (state.cancelled || pending.cancelled || disposed)) {
        delivered = {outcome: {outcome: "cancelled"}}
        try { await append(state, {id: `permission:${id}:dispatch-cancelled`, origin: "local", kind: "permission", permissionId: id,
          requestId: state.document.activeRequest ?? "preparation", requestHash: request.requestHash!, source: request.source!, phase: "cancelled", title: request.title}) }
        finally { state.permissions.delete(id); pending.resolve(delivered) }
      }
      state.permissions.delete(id)
      pending.resolve(delivered)
      publish(state)
    })
  }
  const clearPermissions = async (state: State): Promise<void> => {
    const failures: unknown[] = []
    for (const [id, pending] of [...state.permissions]) {
      try { await finishPermission(state, id, {outcome: {outcome: "cancelled"}}) }
      catch (error) { failures.push(error) }
      finally {
        // Отказ диска не оставляет provider callback и процесс навечно ожидающими.
        state.permissions.delete(id)
        pending.resolve({outcome: {outcome: "cancelled"}})
      }
    }
    if (failures.length) throw new AggregateError(failures, "Не удалось сохранить отмену запросов разрешения")
  }
  const askPermission = async (state: State, request: Parameters<StorybookTechAcp.Input["onPermission"]>[0], source: "provider" | "environment", signal?: AbortSignal): Promise<PermissionResponse> => {
    if (state.cancelled || disposed || signal?.aborted) return {outcome: {outcome: "cancelled"}}
    clearPublication(state)
    request = structuredClone(request)
    const id = randomUUID()
    const encoded = JSON.stringify(request)
    const requestHash = createHash("sha256").update(encoded).digest("hex")
    const detailsId = `permission:${id}:request`
    const maximum = 64 * 1024
    const rawOversized = Buffer.byteLength(encoded) > maximum
    const value: Permission = rawOversized
      ? {id, requestHash, detailsId, source, title: "Большой запрос подтверждения", options: []}
      : {id, requestHash, detailsId, source, title: request.toolCall.title ?? "Разрешение действия",
        request, options: request.options.map(option => ({id: option.optionId, name: option.name, kind: option.kind}))}
    const bytes = rawOversized ? maximum + 1 : Buffer.byteLength(JSON.stringify(value))
    const result = Promise.withResolvers<PermissionResponse>()
    let unsupported = false
    await exclusive(state, async () => {
      const pendingBytes = Buffer.byteLength(JSON.stringify([...state.permissions.values()].map(item => item.value)))
      if (bytes + pendingBytes + Number(state.permissions.size > 0) > maximum) {
        const error = "Объём условий подтверждения превышает лимит интерфейса 64 КиБ. Это действие отменено и не разрешалось. Полный запрос сохранён в истории; разбейте действие на меньшие части."
        const previousError = state.document.error
        state.document.error = error
        const {schemaVersion, ...metadata} = state.document
        state.write = state.write.catch(() => {}).then(() => state.archive.commit(structuredClone(metadata), [
          {type: "append", item: {id: detailsId, origin: "local", kind: "permission", permissionId: id,
            requestId: state.document.activeRequest ?? "preparation", requestHash, source, phase: "requested",
            title: "Запрос подтверждения превышает предел интерфейса", request,
            policy: {mode: state.approvalMode ?? "ask", ...(state.approvalPolicyRevision === undefined ? {} : {revision: state.approvalPolicyRevision})}}},
          {type: "append", item: {id: `permission:${id}:decision`, origin: "local", kind: "permission", permissionId: id,
            requestId: state.document.activeRequest ?? "preparation", requestHash, source, phase: "cancelled",
            title: "Подтверждение недоступно: слишком большой запрос", error}},
        ]))
        try {await state.write} catch (failure) {state.document.error = previousError; throw failure}
        unsupported = true
        publish(state)
        return
      }
      const ids = [...state.document.pendingPermissions ?? [], id]
      const previousPending = state.document.pendingPermissions
      state.document.pendingPermissions = ids
      const {schemaVersion, ...metadata} = state.document
      state.write = state.write.catch(() => {}).then(() => state.archive.commit(structuredClone(metadata), [{type: "append", item: {
        id: `permission:${id}:request`, origin: "local", kind: "permission", permissionId: id,
        requestId: state.document.activeRequest ?? "preparation", requestHash, source, phase: "requested",
        title: value.title, request: structuredClone(request),
        policy: {mode: state.approvalMode ?? "ask", ...(state.approvalPolicyRevision === undefined ? {} : {revision: state.approvalPolicyRevision})},
      }}]))
      try { await state.write } catch (error) {
        if (previousPending === undefined) delete state.document.pendingPermissions
        else state.document.pendingPermissions = previousPending
        throw error
      }
      state.permissions.set(id, {value, resolve: result.resolve})
    })
    if (unsupported) return {outcome: {outcome: "cancelled"}}
    const cancel = () => {
      const pending = state.permissions.get(id)
      if (pending) pending.cancelled = true
      void finishPermission(state, id, {outcome: {outcome: "cancelled"}}).catch(() => {
        state.permissions.delete(id)
        result.resolve({outcome: {outcome: "cancelled"}})
        publish(state)
      })
    }
    signal?.addEventListener("abort", cancel, {once: true})
    try {
      if (state.cancelled || disposed || signal?.aborted) cancel()
      else if (state.approvalMode === "scoped-autonomous" && source === "environment") {
        // Разрешение один раз не создаёт скрытого persistent prefix/network правила.
        const option = request.options.find(option => option.kind === "allow_once")
        if (option) await finishPermission(state, id, {outcome: {outcome: "selected", optionId: option.optionId}}, "policy")
        else publish(state)
      } else publish(state)
      return await result.promise
    } finally { signal?.removeEventListener("abort", cancel) }
  }
  /** Одна ACP-сессия для настроек и сообщений; подготовка не запускает prompt. */
  const connect = async (state: State): Promise<StorybookTechAcp.Output> => {
    const execution = await refreshExecution(state)
    if (state.document.sessionId !== undefined && (state.document.connectionId ?? "codex") !== execution.effective.connectionId) throw new Error("Подключение существующей native сессии отличается: несовместимое восстановление запрещено")
    if (!execution.connections.some(connection => connection.id === execution.effective.connectionId && connection.enabled)) throw new Error("Выбранное подключение отключено: включите его перед продолжением беседы")
    if (state.connection !== undefined) {
      await applyExecution(state, state.connection, execution)
      return state.connection
    }
    if (state.connecting !== undefined) return state.connecting
    state.cursor = {}
    clearTimeout(state.idleTimer)
    delete state.idleTimer
    const pending = (async () => {
      await acquireSlot(state)
      ownerCwd(state.document.cwd)
      if (state.environment === undefined && input.environment !== undefined) {
        state.environment = await input.environment({
          executorId: state.document.executorId,
          sessionId: state.id,
          executorLabel: state.document.executorLabel,
          address: state.subject.address,
          async onUpdate(update) {
            return receive(state, update, "local")
          },
          async authorize(id, command, signal) {
            if (state.document.activeRequest === undefined || state.cancelled || disposed) throw new Error("У действия нет активного выполнения")
            const response = await askPermission(state, {sessionId: state.id,
              toolCall: {toolCallId: id, title: command.name, status: "pending", rawInput: structuredClone(command.arguments)},
              options: [{optionId: "allow-once", name: "Разрешить действие", kind: "allow_once"},
                {optionId: "reject-once", name: "Отклонить действие", kind: "reject_once"}],
            }, "environment", signal)
            signal.throwIfAborted()
            if (state.cancelled || response.outcome.outcome !== "selected" || response.outcome.optionId !== "allow-once") throw new Error(state.document.error ?? "Действие не разрешено")
          },
        })
      }
      const connection = await input.connect({
        subject: state.subject,
        localSessionId: state.id,
        executorId: state.document.executorId,
        executorLabel: state.document.executorLabel,
        execution,
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
          await receive(state, update, "replay")
          if (update.sessionUpdate === "config_option_update") state.settings = readSettings(update.configOptions)
          if (update.sessionUpdate === "usage_update" && Number.isFinite(update.used) && update.used >= 0 && Number.isFinite(update.size) && update.size > 0) state.document.usage = {used: update.used, size: update.size}
          scheduleSave(state)
        },
        async onUpdate(update) {
          await receive(state, update, "live")
          if (update.sessionUpdate === "config_option_update") {
            const previousModel = state.settings?.find(option => option.category === "model")?.value
            state.settings = readSettings(update.configOptions)
            if (previousModel !== undefined && previousModel !== state.settings.find(option => option.category === "model")?.value) delete state.document.usage
          }
          if (update.sessionUpdate === "usage_update" && Number.isFinite(update.used) && update.used >= 0 && Number.isFinite(update.size) && update.size > 0) {
            state.document.usage = {used: update.used, size: update.size}
          }
          scheduleSave(state)
        },
        onPermission(request, signal) { return askPermission(state, request, "provider", signal) },
      })
      state.connection = connection
      state.settings = readSettings(connection.configOptions ?? [])
      state.document.executionBaseline ??= Object.fromEntries(state.settings.filter(option => option.category !== "mode").map(option => [option.category === "model" ? "model" : "thoughtLevel", option.value]))
      if (state.document.sessionId !== undefined && state.document.connectionId === undefined) state.document.preserveNativeSettings = true
      state.document.sessionId = connection.sessionId
      state.document.connectionId = execution.effective.connectionId
      state.document.cwd = "."
      await save(state)
      await applyExecution(state, connection, execution)
      await save(state)
      return connection
    })()
    state.connecting = pending
    try { return await pending } catch (error) {
      await releaseConnection(state, false)
      throw error
    } finally {
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
      state.approvalMode = state.execution?.effective.approvalMode ?? "ask"
      if (state.execution?.approvalPolicyRevision === undefined) delete state.approvalPolicyRevision
      else state.approvalPolicyRevision = state.execution.approvalPolicyRevision
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
        await append(state, {id: randomUUID(), origin: "local",
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
        state.document.activeRequest = requestId
        try {
          const {schemaVersion, ...metadata} = state.document
          await state.archive.commit(metadata, [{type: "append", item: {id: markerId, origin: "local", kind: "turn", requestId, state: "started"}}])
          started = true
        } catch (error) {
          state.document.pending.splice(index, 0, messageId)
          delete state.document.activeRequest
          await state.archive.commit(undefined, [{type: "remove", id: markerId}])
          throw error
        }
      })
      while (!state.cancelled && !disposed) {
        delete state.cursor.message
        const after = state.archive.stats().lastSequence + 1
        const result = await connection.prompt(supplied)
        if (signature !== undefined) state.document.environmentContext = signature
        stopReason = result.stopReason
        interrupted = state.cancelled || disposed || result.stopReason === "cancelled"
        if (interrupted || result.stopReason !== "end_turn" || environment === undefined) break
        const message = state.archive.lastAssistant(after)
        const command = message?.kind === "message" ? readCommand(state.archive.content(message.id)) : null
        if (command === null || message?.kind !== "message") break
        await state.archive.commit(undefined, [{type: "purpose", id: message.id}])
        publish(state)
        // Сохраняем решение до исполнения: сбой никогда не повторяет возможную мутацию сам.
        await save(state)
        const resultContent = await environment.execute(command, state.turnController!.signal)
        await append(state, {id: randomUUID(), origin: "local",
          kind: "context", content: structuredClone(resultContent), requestId})
        supplied = [...resultContent]
        await save(state)
        publish(state)
      }
      interrupted ||= state.cancelled || disposed
      if (!interrupted && stopReason !== undefined && stopReason !== "end_turn") {
        state.document.status = "failed"
        state.document.error = stopReason === "max_tokens" ? "Достигнут лимит токенов ответа" : stopReason === "max_turn_requests"
          ? "Достигнут лимит обращений модели" : stopReason === "refusal" ? "Исполнитель отказался продолжать" : `Выполнение завершилось: ${stopReason}`
      }
    } catch (error) {
      clearPublication(state)
      state.document.historyComplete = false
      interrupted = state.cancelled || disposed
      state.document.status = interrupted ? "idle" : "failed"
      state.document.error = interrupted ? null : error instanceof Error ? error.message : String(error)
      const connection = state.connection
      delete state.connection
      await connection?.dispose().catch(() => {})
      state.releaseSlot?.()
    } finally {
      clearPublication(state)
      await clearPermissions(state).catch(error => { state.document.error = `Не удалось сохранить отмену разрешения: ${error instanceof Error ? error.message : String(error)}` })
      clearTimeout(state.flushTimer)
      delete state.flushTimer
      delete state.cursor.message
      if (!started && state.cancelled && !disposed) state.document.pending = state.document.pending.filter(id => id !== `user:${requestId}`)
      if (!started && state.document.status === "failed") state.retryBlocked = true
      if (state.document.status !== "failed") state.document.status = "idle"
      try {
        await state.write
        const {schemaVersion, activeRequest, ...metadata} = state.document
        await state.archive.commit(metadata, [
          ...(interrupted && state.document.status === "idle" ? [{type: "append" as const, item: {
            id: randomUUID(), origin: "local" as const, kind: "message" as const, role: "system" as const,
            content: [{type: "text" as const, text: "Выполнение остановлено."}],
          }}] : []),
          {type: "append", item: {id: randomUUID(), origin: "local", kind: "turn", requestId,
            state: state.document.status === "failed" ? "failed" : interrupted ? "cancelled" : "completed",
            ...(stopReason === undefined ? {} : {stopReason}),
            ...(state.document.error === null ? {} : {error: state.document.error}),
          }},
        ])
        delete state.document.activeRequest
      } catch (error) {
        state.document.status = "failed"
        state.document.historyComplete = false
        state.retryBlocked = true
        state.document.error = `Не удалось сохранить завершение: ${error instanceof Error ? error.message : String(error)}`
      } finally {
        // Освобождение исполнения не зависит от доступности диска.
        delete state.turn
        delete state.turnController
      }
      publish(state)
    }
  }
  /** Очередь хранит только ссылки; durable start отделён от ещё не начатых входящих задач. */
  const wake = (state: State): void => {
    if (disposed || state.draining !== undefined || state.retryBlocked || state.moveBlocked || !state.document.pending.length || relocating.has(state.key)) return
    const draining = (async () => {
      while (!disposed && !state.retryBlocked) {
        const selected = await exclusive(state, async () => {
          if (disposed || state.moveBlocked || relocating.has(state.key) || state.turn !== undefined || state.configuring || state.connecting !== undefined) return undefined
          const messageId = state.document.pending[0]
          if (messageId === undefined) return undefined
          const requestId = messageId.slice(5)
          const message = state.archive.lookup(messageId)
          if (message?.kind !== "message" || message.role !== "user") throw new Error("Входящая задача не имеет canonical user message")
          const blocks = await state.archive.media.materialize(state.archive.content(messageId)) as ReturnType<Archive["content"]>
          const content = blocks.length === 1 && blocks[0]?.type === "text" && Object.keys(blocks[0]).every(key => key === "type" || key === "text") ? blocks[0].text : blocks
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
      idle(state)
      void trim()
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
      const previous = state.archive.lookup(id)
      if (previous !== null) {
        if (previous.kind !== "message" || JSON.stringify(state.archive.content(id)) !== JSON.stringify(await state.archive.media.normalize(content))) throw new Error("Идентификатор отправки уже использован для другого сообщения")
        if (state.document.pending.includes(id) || state.archive.hasStarted(requestId) || state.archive.hasTerminal(requestId)) return
        // Подтверждённое сообщение без durable start и очереди можно принять повторно.
      }
      if (!queued && (state.configuring || state.turn !== undefined || state.connecting !== undefined || state.document.pending.length)) {
        throw new Error("Дождитесь завершения текущего ответа")
      }
      if (state.document.pending.length >= maxPending) throw new Error("Очередь беседы заполнена")
      const before = structuredClone(state.document)
      if (state.document.sessionLabelSource !== "manual" && !state.document.sessionLabelAssigned && (state.document.sessionLabel === undefined || state.document.sessionLabel === "Новая беседа")) {
        const text = content.flatMap(block => block.type === "text" ? [block.text] : []).join(" ").trim()
        state.document.sessionLabel = text ? text.split(/\s+/u).slice(0, 6).join(" ").slice(0, 64) : content.some(block => block.type === "image") ? "Изображение" : "Вложение"
        state.document.sessionLabelSource = "auto"
        state.document.sessionLabelAssigned = true
      }
      state.document.pending.push(id)
      if (!queued || !state.retryBlocked && state.turn === undefined && !state.configuring && state.connecting === undefined) {
        state.document.status = state.connection === undefined ? "connecting" : "running"
        state.document.error = null
      }
      const {schemaVersion, ...metadata} = structuredClone(state.document)
      const contexts = content.filter(block => block.type === "resource" || block.type === "resource_link")
      state.write = state.write.catch(() => {}).then(() => state.archive.commit(metadata, previous === null ? [
        {type: "append", item: {id, origin: "local", kind: "message", role: "user", content}},
        ...(contexts.length ? [{type: "append" as const, item: {id: randomUUID(), origin: "local" as const,
          kind: "context" as const, content: contexts, requestId}}] : []),
      ] : []))
      try {
        await state.write
        state.retryBlocked = false
      } catch (error) {
        state.document = before
        state.document.status = "failed"
        state.document.error = `Не удалось сохранить сообщение: ${error instanceof Error ? error.message : String(error)}`
        publish(state)
        throw error
      }
      publish(state)
    })
    wake(state)
    return snapshot(state)
  }
  const actions: StorybookChatSession.Output = {
    async create({address, label}) {
      if (disposed) throw new Error("Чаты остановлены")
      if (typeof label !== "string" || label.trim().length === 0 || label.trim().length > 128) throw new TypeError("Имя исполнителя должно содержать от 1 до 128 символов")
      const subject = input.resolve(address)
      const executorId = randomUUID()
      const document: Document = {schemaVersion: 3, id: randomUUID(), executorId, executorLabel: label.trim(), address: subject.address,
        pending: [], historyComplete: true, status: "idle", error: null}
      const file = chatFile(input.directory(subject), subject.address, executorId)
      const key = targetKey(subject.address, executorId)
      const pending = (async () => {
        await copyHistory(file, document)
        return await makeState(subject, file, document, false)
      })()
      states.set(key, pending)
      try {
        const state = lease(await pending)
        const value = snapshot(state)
        idle(state)
        return value
      } catch (error) {
        if (states.get(key) === pending) states.delete(key)
        throw error
      }
    },
    async createSession(target, label) {
      const parts = targetParts(target)
      const subject = input.resolve(parts.address)
      if (label !== undefined && (typeof label !== "string" || label.trim().length > 128)) throw new TypeError("Имя сессии должно содержать до 128 символов")
      const manual = label !== undefined && label.trim().length > 0
      const records = await sessionRecords(subject)
      let agent = records.find(record => parts.executorId === undefined ? record.isDefault : record.document.executorId === parts.executorId)?.document
      if (agent === undefined) agent = (await load(target)).document
      const id = randomUUID()
      const document: Document = {schemaVersion: 3, id, executorId: agent.executorId, executorLabel: agent.executorLabel,
        sessionLabel: manual ? label!.trim() : "Новая беседа", sessionLabelSource: manual ? "manual" : "auto", address: subject.address, pending: [], historyComplete: true, status: "idle", error: null}
      const file = chatFile(input.directory(subject), subject.address, agent.executorId, id)
      await copyHistory(file, document)
      const state = lease(await makeState(subject, file, document, false))
      states.set(state.key, Promise.resolve(state))
      return snapshot(state)
    },
    async listSessions(target) {
      const parts = targetParts(target)
      const subject = input.resolve(parts.address)
      const records = await sessionRecords(subject)
      const executorId = parts.executorId ?? records.find(record => record.isDefault)?.document.executorId ?? (await load(target)).document.executorId
      const values: Snapshot[] = []
      for (const record of records) {
        if (record.deleted || record.document.executorId !== executorId) continue
        values.push(await summarize(subject, record.file, record.document))
      }
      return values
    },
    async renameSession(target, label) {
      const parts = targetParts(target)
      if (parts.sessionId === undefined) throw new Error("Выберите точную сессию для переименования")
      if (typeof label !== "string" || label.trim().length === 0 || label.trim().length > 128) throw new TypeError("Имя сессии должно содержать от 1 до 128 символов")
      const state = await load(target)
      await exclusive(state, async () => {
        state.document.sessionLabel = label.trim()
        state.document.sessionLabelSource = "manual"
        state.document.sessionLabelAssigned = true
        await save(state)
        publish(state)
      })
      return snapshot(state)
    },
    async deleteSession(target) {
      const parts = targetParts(target)
      if (parts.sessionId === undefined) throw new Error("Выберите точную сессию для удаления")
      const subject = input.resolve(parts.address)
      const existing = (await sessionRecords(subject)).find(record => record.deleted && record.document.id === parts.sessionId &&
        (parts.executorId === undefined || record.document.executorId === parts.executorId))
      if (existing !== undefined) return
      const state = await load(target)
      await exclusive(state, async () => {
        if (busy(state) || state.document.status === "connecting" || state.document.status === "running") throw new Error("Завершите текущую работу и очередь сессии перед удалением")
        await releaseConnection(state)
        clearPublication(state)
        clearTimeout(state.flushTimer)
        delete state.flushTimer
        await state.write
        await state.archive.flush()
        await softDelete({file: state.file, sessionId: state.id})
        state.moveBlocked = true
        await state.archive.dispose()
        states.delete(state.key)
        state.listeners.clear()
      })
    },
    async listDeletedSessions(target) {
      const parts = targetParts(target)
      const subject = input.resolve(parts.address)
      const records = await sessionRecords(subject)
      const executorId = parts.executorId ?? records.find(record => record.isDefault)?.document.executorId
      const values: (Snapshot & {deletedAt?: string, recoverable: boolean})[] = []
      for (const record of records) {
        if (!record.deleted || record.document.executorId !== executorId) continue
        const removed = await readTrash(record.file)
        if (removed === null || removed.purgedAt !== undefined) continue
        const saved = await readArchiveState(record.file)
        const history = saved?.history ?? {revision: 0, total: 0, lastSequence: 0}
        const value = snapshot({id: record.document.id, document: record.document, subject,
          archive: {stats: () => history, displayStats: () => saved?.displayHistory ?? history},
          version: record.document.controlVersion ?? 0, permissions: new Map(),
          execution: await refreshExecution({document: record.document, subject}),
        })
        values.push({...value, ...(removed.deletedAt === undefined ? {} : {deletedAt: removed.deletedAt}), recoverable: !removed.purging && saved !== null})
      }
      return values
    },
    async restoreSession(target) {
      const parts = targetParts(target)
      if (parts.sessionId === undefined || parts.executorId === undefined) throw new Error("Нужны точные identity агента и удалённой беседы")
      const subject = input.resolve(parts.address)
      const record = (await sessionRecords(subject)).find(record => record.document.id === parts.sessionId && record.document.executorId === parts.executorId)
      if (record === undefined) throw new Error("Удалённая беседа не найдена")
      if (!record.deleted) return snapshot(await load(target))
      await restoreTrash({file: record.file, sessionId: parts.sessionId})
      return snapshot(await load(target))
    },
    async purgeSession(target) {
      const parts = targetParts(target)
      if (parts.sessionId === undefined || parts.executorId === undefined) throw new Error("Нужны точные identity агента и удалённой беседы")
      const subject = input.resolve(parts.address)
      const record = (await sessionRecords(subject)).find(record => record.deleted && record.document.id === parts.sessionId && record.document.executorId === parts.executorId)
      if (record === undefined) throw new Error("Удалённая беседа не найдена")
      await purgeTrash({file: record.file, sessionId: parts.sessionId})
    },
    async list(address) {
      if (disposed) throw new Error("Чаты остановлены")
      const subject = input.resolve(address)
      const selected = new Map<string, {value: Snapshot, isDefault: boolean, designated: boolean}>()
      for (const [key, pending] of states) {
        if (!key.startsWith(`[${JSON.stringify(subject.address)},`)) continue
        const state = lease(await pending)
        if (state.subject.address === subject.address && await deletedMetadata(state.file) === null && await movedSource(state.file, state.document) === null) {
          state.subject = subject
          await state.archive.flush()
          const designated = basename(state.file).split(".").length < 4
          if (!selected.has(state.document.executorId) || designated) selected.set(state.document.executorId, {value: snapshot(state), isDefault: state.isDefault, designated})
        }
      }
      const directory = input.directory(subject)
      const defaultName = chatFile("", subject.address)
      const prefix = defaultName.slice(0, -5)
      const add = async (file: string, isDefault: boolean): Promise<void> => {
        if (await deletedMetadata(file) !== null) return
        const document = await readChatDocument(file, subject.address)
        if (document === null || selected.get(document.executorId)?.designated || await movedSource(file, document) !== null) return
        const value = await summarize(subject, file, document)
        selected.set(document.executorId, {value, isDefault, designated: true})
      }
      const entries = await readdir(directory, {withFileTypes: true}).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        return []
      })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        if (entry.name === defaultName) await add(join(directory, entry.name), true)
        else if (entry.name.startsWith(`${prefix}.`) && entry.name.endsWith(".json")) {
          const suffix = entry.name.slice(prefix.length + 1, -5)
          if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(suffix)) await add(join(directory, entry.name), false)
        }
      }
      if (![...selected.values()].some(item => item.isDefault) && input.legacyDirectory !== undefined) {
        const file = chatFile(input.legacyDirectory, subject.address)
        const legacy = await importLegacy(file, chatFile(directory, subject.address), subject.address)
        if (legacy !== null && await movedSource(chatFile(directory, subject.address), legacy) === null) {
          await add(chatFile(directory, subject.address), true)
        }
      }
      for (const record of (await sessionRecords(subject)).sort((a, b) => Number(a.deleted) - Number(b.deleted))) {
        if (selected.has(record.document.executorId)) continue
        const value = await summarize(subject, record.deleted ? `${record.file}.placeholder` : record.file, record.document, record.deleted)
        selected.set(record.document.executorId, {value, isDefault: record.isDefault, designated: false})
      }
      const result = [...selected.values()].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.value.executorId.localeCompare(b.value.executorId)).map(item => item.value)
      selected.clear()
      return result
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
        const metadata = await readArchiveMetadata(file)
        if (metadata === null) continue
        const document: Document = {...metadata, schemaVersion: 3}
        const address = document.address
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
        await importLegacy(file, target, address)
        migrated += 1
      }
      return {migrated, unresolved}
    },
    async read(target) {
      const state = await load(target)
      await state.archive.flush()
      const value = snapshot(state)
      return value
    },
    async displayHistory(target, query = {}) {
      const state = await load(target)
      await state.archive.flush()
      return state.archive.display(query)
    },
    async groupHistory(target, groupId, query = {}) {
      const state = await load(target)
      await state.archive.flush()
      return state.archive.groupPage(groupId, query)
    },
    async groupHistoryItem(target, groupId, id) {
      const state = await load(target)
      await state.archive.flush()
      return state.archive.groupBody(groupId, id)
    },
    async history(target, query = {}) {
      const state = await load(target)
      await state.archive.flush()
      const value = state.archive.page(query)
      return value
    },
    async historyItem(target, id) {
      const state = await load(target)
      await state.archive.flush()
      const value = state.archive.body(id)
      return value
    },
    async historyContent(target, id, query = {}) {
      const state = await load(target)
      await state.archive.flush()
      return state.archive.contentPage(id, query)
    },
    async historyTerminal(target, id, query = {}) {
      const state = await load(target)
      await state.archive.flush()
      return state.archive.terminalPage(id, query)
    },
    async historyDetail(target, id, query = {}) {
      const state = await load(target)
      await state.archive.flush()
      return state.archive.detailPage(id, query)
    },
    async hasMedia(target, digest) {
      const state = await load(target)
      await state.archive.flush()
      return state.archive.hasMedia(digest)
    },
    async copyMessage(target, id) {
      const state = await load(target)
      await state.archive.flush()
      const content = await state.archive.media.materialize(state.archive.content(id)) as ReturnType<Archive["content"]>
      return content.flatMap(block => block.type === "text" ? [block.text] : []).join("")
    },
    async historyEvidence(target, id, query = {}) {
      const state = await load(target)
      await state.archive.flush()
      const value = state.archive.evidence(id, query)
      return value
    },
    async prepare(target) {
      const state = await load(target)
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
        idle(state)
      }
      return snapshot(state)
    },
    async configure(target, id, value) {
      const state = await load(target)
      if (state.turn !== undefined || state.configuring) throw new Error("Дождитесь завершения текущей операции чата")
      const option = state.settings?.find(item => item.id === id)
      if (option?.category === "mode") throw new Error("Native sandbox не меняется: выберите режим подтверждений в пределах назначения")
      if (!option || !option.options.some(item => item.value === value)) throw new Error("Выберите доступный вариант настройки")
      if (state.lifetime.signal.aborted) state.lifetime = new AbortController()
      state.cancelled = false
      state.configuring = true
      publish(state)
      try {
        const connection = state.connection ?? await connect(state)
        const previousUsage = state.document.usage
        state.settings = readSettings(await connection.setConfigOption(id, value))
        if (option.category === "model" && value !== option.value && state.document.usage === previousUsage) delete state.document.usage
        state.document.executionSelection = {...state.document.executionSelection,
          [option.category === "model" ? "model" : "thoughtLevel"]: value}
        await refreshExecution(state)
        await save(state)
      } finally {
        state.configuring = false
        publish(state)
        wake(state)
        idle(state)
      }
      return snapshot(state)
    },
    async configureExecution(target, change) {
      const state = await load(target)
      if (busy(state)) throw new Error("Завершите текущую работу и очередь перед изменением выбора исполнения")
      if (change.scope !== "session" && change.scope !== "executor") throw new TypeError("Выберите настройки беседы или агента")
      const affected = change.scope === "executor" ? (await Promise.all([...states.values()])).filter(other => other.document.executorId === state.document.executorId) : [state]
      if (change.scope === "executor") {
        const records = await sessionRecords(state.subject)
        if (records.some(record => !record.deleted && record.document.executorId === state.document.executorId &&
          (record.document.pending.length > 0 || record.document.status === "connecting" || record.document.status === "running"))) throw new Error("Завершите работу и очереди всех бесед агента перед изменением его настроек")
      }
      if (affected.some(other => busy(other))) throw new Error("Завершите работу и очереди всех бесед агента перед изменением его настроек")
      const selected = change.selection
      if (selected === null || typeof selected !== "object" || Array.isArray(selected) || Object.keys(selected).some(key => !["connectionId", "model", "thoughtLevel", "approvalMode"].includes(key)) ||
        Object.values(selected).some(value => typeof value !== "string" || !value.trim() || value.length > 256)) throw new TypeError("Недопустимый выбор исполнения")
      if (selected.connectionId !== undefined && selected.connectionId !== (state.document.connectionId ?? "codex")) throw new Error("Подключение существующей native сессии отличается: несовместимое восстановление запрещено")
      for (const [field, category] of [["model", "model"], ["thoughtLevel", "thought_level"]] as const) {
        const option = state.settings?.find(item => item.category === category)
        if (selected[field] !== undefined && option !== undefined && !(category === "thought_level" && selected.model !== undefined) && !option.options.some(item => item.value === selected[field])) throw new Error(`Выбранная настройка ${category} недоступна`)
      }
      if (selected.approvalMode !== undefined && selected.approvalMode !== "ask" && selected.approvalMode !== "scoped-autonomous") throw new TypeError("Режим подтверждений не поддерживается")
      const previous = state.document.executionSelection
      const previousPreserve = state.document.preserveNativeSettings
      for (const other of affected) {
        other.configuring = true
        publish(other)
      }
      try {
        const candidateDocument = {...state.document, preserveNativeSettings: false,
          ...(change.scope === "session" ? {executionSelection: structuredClone(selected)} : {})}
        const candidateExecutor = change.scope === "executor" ? selected : undefined
        const candidate = await refreshExecution({document: candidateDocument, subject: state.subject, settings: state.settings ?? []}, candidateExecutor)
        if (state.connection !== undefined) await applyExecution(state, state.connection, candidate, candidateDocument)
        if (change.scope === "executor") {
          if (input.saveExecutorSelection === undefined) throw new Error("Хранилище выбора исполнителя не подключено")
          await input.saveExecutorSelection({subject: state.subject, executorId: state.document.executorId, selection: structuredClone(selected)})
        }
        if (change.scope === "session") {
          if (input.saveSessionApproval !== undefined) await input.saveSessionApproval({sessionId: state.id, ...(selected.approvalMode === undefined ? {} : {approvalMode: selected.approvalMode})})
          else if (selected.approvalMode !== undefined) throw new Error("Доверенное хранилище политики не подключено")
          const {approvalMode: _mode, ...portable} = selected
          state.document.executionSelection = structuredClone(portable)
        }
        state.document.preserveNativeSettings = false
        await save(state)
      } catch (error) {
        if (previous === undefined) delete state.document.executionSelection
        else state.document.executionSelection = previous
        if (previousPreserve === undefined) delete state.document.preserveNativeSettings
        else state.document.preserveNativeSettings = previousPreserve
        // Частично применённый model/effort не продолжает turn с неверным выбором.
        await releaseConnection(state)
        delete state.settings
        throw error
      } finally {
        for (const other of affected) {
          other.configuring = false
          await refreshExecution(other)
          publish(other)
          wake(other)
          idle(other)
        }
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
      await clearPermissions(state).catch(error => { state.document.error = String(error) })
      if (state.connection === undefined) state.lifetime.abort(new Error("Подключение отменено"))
      publish(state)
      await state.connection?.cancel()
      return snapshot(state)
    },
    async permission(target, id, optionId, requestHash) {
      const state = await load(target)
      await finishPermission(state, id, {outcome: {outcome: "selected", optionId}}, "user", requestHash)
      return snapshot(state)
    },
    async stop(target) {
      const state = await load(target)
      state.retryBlocked = true
      state.cancelled = true
      state.turnController?.abort(new Error("Исполнение остановлено пользователем"))
      await clearPermissions(state).catch(() => {})
      state.lifetime.abort(new Error("Подключение завершено пользователем"))
      await releaseConnection(state)
      await state.turn
      publish(state)
      return snapshot(state)
    },
    async subscribe(target, listener) {
      const state = await load(target)
      if (disposed) throw new Error("Чаты остановлены")
      if (relocating.has(state.key)) throw new Error("Беседа переносится на новый адрес")
      state.listeners.add(listener)
      listener(snapshot(state))
      return () => {
        state.listeners.delete(listener)
        if (state.listeners.size === 0) {
          clearPublication(state)
          idle(state)
          void trim()
        }
      }
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
            ?? (input.legacyDirectory === undefined ? null : await importLegacy(chatFile(input.legacyDirectory, from.address), oldFile, from.address))
          if (source?.executorId !== executorId) return null
          isDefault = true
        } else if (source === null && isDefault && input.legacyDirectory !== undefined) {
          source = await importLegacy(chatFile(input.legacyDirectory, from.address), oldFile, from.address)
        }
        if (source === null) return null
        if (current !== undefined && (current.id !== source.id || current.document.address !== from.address)) throw new Error("Загруженная беседа не совпадает с сохранённой историей")
        if (current !== undefined) source.executorId = current.document.executorId
        if (executorId !== undefined && source.executorId !== executorId) throw new Error("История принадлежит другому исполнителю")
        ownerCwd(source.cwd)
        const sourceKey = targetKey(from.address, isDefault ? undefined : source.executorId)
        const destinationKey = targetKey(to.address, isDefault ? undefined : source.executorId)
        hold(sourceKey, destinationKey)
        const newFile = chatFile(input.directory(to), to.address, isDefault ? undefined : source.executorId)
        const existing = await loaded(to.address, isDefault ? undefined : source.executorId)
        await existing?.mutations
        const destination = await readChatDocument(newFile, to.address)
        if (destination !== null && (destination.id !== source.id || destination.executorId !== source.executorId)) throw new Error("Новый адрес уже занят другой беседой")
        if (destination !== null) ownerCwd(destination.cwd)
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
          await releaseConnection(current)
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
            ...(source.cwd === undefined ? {} : {cwd: "."})}, oldFile)
        } catch (error) {
          throw new Error("Перенос ожидает завершения; исходная история сохранена. Повторите то же соответствие адресов.", {cause: error})
        }
        if (document.executorId !== source.executorId) throw new Error("Identity назначения не совпадает с исполнителем")
        if (current !== undefined && existing === undefined) {
          states.delete(current.key)
          current.key = destinationKey
          current.subject = subject
          current.file = newFile
          await current.archive.dispose()
          const {schemaVersion, ...metadata} = document
          current.archive = await openArchive(newFile, metadata)
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
            result = await makeState(subject, newFile, document, isDefault)
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
      for (const wakeSlot of slotWaiters.splice(0)) wakeSlot()
      await trimming
      const results = await Promise.allSettled([...states.values()].map(async pending => {
        const state = await pending.catch(() => undefined)
        if (state === undefined) return
        clearPublication(state)
        clearTimeout(state.idleTimer)
        state.cancelled = true
        state.turnController?.abort(new Error("Сервер чатов останавливается"))
        state.lifetime.abort(new Error("Сервер чатов останавливается"))
        await clearPermissions(state).catch(() => {})
        const errors: unknown[] = []
        const release = async (action: () => unknown | Promise<unknown>) => {
          try { await action() } catch (error) { errors.push(error) }
        }
        await release(() => state.mutations)
        await release(() => state.connecting)
        await release(() => releaseConnection(state))
        await release(() => state.turn)
        await release(() => state.draining)
        if (state.flushTimer !== undefined) {
          clearTimeout(state.flushTimer)
          delete state.flushTimer
          await release(() => save(state))
        }
        await release(() => state.write)
        state.listeners.clear()
        await release(() => state.environment?.dispose())
        await release(() => state.archive.dispose())
        if (errors.length) throw new AggregateError(errors, "Ошибки освобождения беседы")
      }))
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected")
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Не все чаты удалось освободить")
    },
  }
  return Object.fromEntries(Object.entries(actions).map(([name, action]) => [name, (...arguments_: unknown[]) => access.run(new Set(), async () => {
    const held = access.getStore()!
    try { return await (action as (...arguments_: unknown[]) => Promise<unknown>)(...arguments_) }
    finally {
      for (const state of held) state.leases -= 1
      held.clear()
      if (!disposed) await trim()
    }
  })])) as StorybookChatSession.Output
}
