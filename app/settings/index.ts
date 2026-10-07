/**
Сохраняет переносимый выбор исполнения Project и предметных исполнителей.
Каталог подключений сохраняется только в `.local/` текущей машины.
Capsule использует Studio на машине ACP-исполнителя и явно выбранный готовый профиль
Qwen или DeepSeek; состояние профиля принадлежит Capsule.
Необязательное SSH-подключение переносит ACP-процесс на машину Studio и Docker.
Пути Provider и его хранилища относятся к этой машине; отдельный Docker context
назначается только процессу, сохраняя default context машины.
Переносимые правила типов принадлежат среде, явный выбор агента сохраняется
у его предмета независимо от бесед. Настройки разрешаются по каждому значению
с указанием источника; доступные модели и уровни подтверждает само подключение.
Чтение и запись настроек не запускают модель и не предоставляют инструментальных прав.

@packageDocumentation
*/
import {isAbsolute, join} from "node:path"
import type {StorybookAppSettings} from "./contract"

import {document, entityTypes, fields, initial, object, selection, validateSelectionConnection} from "./src/validation"
import {exclusive, executorFile, readJson, save} from "./src/storage"
import {createAuthority, withoutApproval} from "./src/authority"

export type {StorybookAppSettings} from "./contract"

type Document = Awaited<ReturnType<StorybookAppSettings.Output["read"]>>
type ExecutorInput = Parameters<StorybookAppSettings.Output["readExecutor"]>[0]
type Selection = Awaited<ReturnType<StorybookAppSettings.Output["readExecutor"]>>
type Execution = Awaited<ReturnType<StorybookAppSettings.Output["resolve"]>>
type EntityType = NonNullable<ExecutorInput["subject"]["type"]>

/**
Открывает настройки Project; отсутствующий файл означает Codex без выбранной модели.

@param input - Абсолютный корень Project.
@returns Чтение, проверяемая запись и разрешение настроек без подключения ACP.
@throws Повреждённые данные, неизвестное подключение или конфликт revision.
*/
export default function createSettings(input: StorybookAppSettings.Input): StorybookAppSettings.Output {
  if (!isAbsolute(input.project)) throw new TypeError("Project настроек должен быть абсолютным каталогом")
  const file = join(input.project, "meta/settings/execution.json")
  const connectionsFile = join(input.project, ".local/execution-connections.json")
  const authority = createAuthority(input.project, input.authorityDirectory)
  const base = async (): Promise<Document> => {
    const [saved, local] = await Promise.all([readJson(file), readJson(connectionsFile)])
    const value = saved === undefined ? initial() : object(saved, ["schemaVersion", "revision", "connections", "general", "types"])
    if (Array.isArray(value.connections) && value.connections.some(connection => connection?.provider !== "codex" || connection?.endpoint !== undefined)) throw new TypeError("Адреса подключений должны храниться только в локальном каталоге машины")
    let connections = local
    if (local !== undefined && !Array.isArray(local)) {
      const record = object(local, ["schemaVersion", "current", "previous"])
      if (record.schemaVersion !== 1 || record.current === undefined) throw new TypeError("Повреждён локальный каталог подключений")
      const snapshots = [record.current, record.previous].filter(snapshot => snapshot !== undefined).map(snapshot => {
        const entry = object(snapshot, ["revision", "connections"])
        if (!Number.isSafeInteger(entry.revision) || Number(entry.revision) < 0 || !Array.isArray(entry.connections)) throw new TypeError("Повреждена ревизия каталога подключений")
        return entry
      })
      connections = snapshots.find(snapshot => snapshot.revision === value.revision)?.connections
    }
    return document({...value, connections: connections ?? value.connections ?? initial().connections}, true)
  }
  const executorKey = (value: ExecutorInput) => `executor:${value.subject.address}:${value.executorId}`
  const withMode = (value: Selection, mode: Selection["approvalMode"]): Selection => ({
    ...withoutApproval(value), ...(mode === undefined ? {} : {approvalMode: mode}),
  })
  type Policy = Awaited<ReturnType<typeof authority.read>>
  const projectPolicy = (stored: Document, policy: Policy): Document => {
    const types = Object.fromEntries(entityTypes.flatMap(type => {
      const mode = policy.modes[`type:${type}`]
      return stored.types[type] === undefined && mode === undefined ? [] : [[type, withMode(stored.types[type] ?? {}, mode)]]
    }))
    return {...stored, revision: stored.revision + policy.revision,
      general: withMode(stored.general, policy.modes.general), types}
  }
  const read = async (): Promise<Document> => {
    const [stored, policy] = await Promise.all([base(), authority.read()])
    return projectPolicy(stored, policy)
  }
  const readExecutor = async (value: ExecutorInput, policy?: Policy): Promise<Selection> => {
    const saved = await readJson(executorFile(value))
    policy ??= await authority.read()
    if (saved === undefined) return withMode({}, policy.modes[executorKey(value)])
    const record = object(saved, ["schemaVersion", "executorId", "selection"])
    if (record.schemaVersion !== 1 || record.executorId !== value.executorId) throw new TypeError("Повреждена identity настроек исполнителя")
    return withMode(selection(record.selection), policy.modes[executorKey(value)])
  }
  return {
    read,
    update: value => exclusive(file, async () => {
      const current = await read()
      if (value.revision !== current.revision) throw new Error("Настройки изменились: обновите снимок перед сохранением")
      const previous = await base()
      const next = document({...value, schemaVersion: 1, revision: previous.revision + 1})
      await authority.change({general: next.general.approvalMode,
        ...Object.fromEntries(entityTypes.map(type => [`type:${type}`, next.types[type]?.approvalMode]))})
      // Local pending snapshot активируется только revision переносимого документа.
      // Отказ второй записи оставляет previous endpoint действующим и не меняет CAS.
      await save(connectionsFile, {schemaVersion: 1,
        current: {revision: next.revision, connections: next.connections},
        previous: {revision: previous.revision, connections: previous.connections},
      })
      const {connections: _connections, ...portable} = next
      await save(file, {...portable, general: withoutApproval(next.general),
        types: Object.fromEntries(Object.entries(next.types).map(([type, selected]) => [type, withoutApproval(selected!)]))})
      return read()
    }),
    readExecutor,
    updateExecutor: value => exclusive(file, async () => {
      const selected = selection(value.selection)
      validateSelectionConnection(selected, (await base()).connections)
      await authority.change({[executorKey(value)]: selected.approvalMode})
      await save(executorFile(value), {schemaVersion: 1, executorId: value.executorId, selection: withoutApproval(selected)})
    }),
    async updateSessionApproval(value) {
      if (typeof value.sessionId !== "string" || !value.sessionId.trim()) throw new TypeError("Нужна identity беседы")
      await authority.change({[`session:${value.sessionId}`]: value.approvalMode})
    },
    async resolve(value) {
      const [stored, policy] = await Promise.all([base(), authority.read()])
      const current = projectPolicy(stored, policy)
      const selected = withMode(selection(value.selection), value.sessionId === undefined ? undefined : policy.modes[`session:${value.sessionId}`])
      // Candidate model/effort не подменяет уже авторизованный режим агента.
      const trustedExecutor = await readExecutor(value, policy)
      const executorSelection = value.executorSelection === undefined ? trustedExecutor : withMode(selection(value.executorSelection), trustedExecutor.approvalMode)
      const confirmed = entityTypes.includes(value.subject.type as EntityType) ? current.types[value.subject.type!] : undefined
      const effective: {connectionId: string, model?: string, thoughtLevel?: string, approvalMode?: NonNullable<Selection["approvalMode"]>} = {connectionId: current.connections.find(connection => connection.provider === "codex")?.id ?? current.connections[0]!.id}
      const sources: {connectionId: Execution["sources"]["connectionId"], model?: Execution["sources"]["connectionId"], thoughtLevel?: Execution["sources"]["connectionId"], approvalMode?: Execution["sources"]["connectionId"]} = {connectionId: "general"}
      const provider = (id: string) => {
        const connection = current.connections.find(connection => connection.id === id)
        if (!connection) throw new Error("Подключение native сессии недоступно в этой среде")
        return connection.provider
      }
      const changeConnection = (id: string, source: Execution["sources"]["connectionId"]) => {
        provider(id)
        if (effective.connectionId !== id) {
          delete effective.model
          delete effective.thoughtLevel
          delete sources.model
          delete sources.thoughtLevel
        }
        effective.connectionId = id
        sources.connectionId = source
      }
      // Native identity закрепляется до проверки defaults и модели.
      let inheritedConnection = effective.connectionId
      if (value.pinnedConnectionId !== undefined) changeConnection(value.pinnedConnectionId, "native")
      const layers = [["general", current.general], ["type", confirmed], ["executor", executorSelection], ["session", selected]] as const
      for (const [source, layer] of layers) {
        if (layer === undefined) continue
        const nativeDefaults = value.pinnedConnectionId !== undefined && (source === "general" || source === "type")
        if (nativeDefaults) inheritedConnection = layer.connectionId ?? inheritedConnection
        else validateSelectionConnection(layer, current.connections)
        const compatibleDefaults = !nativeDefaults || current.connections.find(connection => connection.id === inheritedConnection)?.provider === provider(effective.connectionId)
        if (!nativeDefaults && layer.connectionId !== undefined) {
          if ((source === "executor" || source === "session") && value.pinnedConnectionId !== undefined && layer.connectionId !== value.pinnedConnectionId) throw new Error("Подключение существующей native сессии отличается: несовместимое восстановление запрещено")
          changeConnection(layer.connectionId, source)
        }
        if (compatibleDefaults && layer.model !== undefined && layer.model !== effective.model && layer.thoughtLevel === undefined) {
          delete effective.thoughtLevel
          delete sources.thoughtLevel
        }
        for (const key of fields) if (key !== "connectionId" && layer[key] !== undefined && (compatibleDefaults || key === "approvalMode")) {
          Object.assign(effective, {[key]: layer[key]!})
          sources[key] = source
        }
      }
      if (!current.connections.some(connection => connection.id === effective.connectionId)) throw new Error("Подключение native сессии недоступно в этой среде")
      return {selection: selected, executorSelection, effective, sources, connections: current.connections,
        ...(value.pinnedConnectionId === undefined ? {} : {pinnedConnectionId: value.pinnedConnectionId}),
        approvalPolicyRevision: policy.revision,
        approvalCapabilities: {modes: authority.enabled ? ["ask", "scoped-autonomous"] : ["ask"], autoReview: false, scope: "assignment"}}
    },
  }
}
