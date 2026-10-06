/**
Сохраняет переносимый выбор исполнения Project и предметных исполнителей.
Общие подключения и правила типов принадлежат среде, явный выбор агента сохраняется
у его предмета независимо от бесед. Настройки разрешаются по каждому значению
с указанием источника; доступные модели и уровни подтверждает само подключение.
Чтение и запись настроек не запускают модель и не предоставляют инструментальных прав.

@packageDocumentation
*/
import {isAbsolute, join} from "node:path"
import type {StorybookAppSettings} from "./contract"

import {document, entityTypes, fields, initial, object, selection} from "./src/validation"
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
  const authority = createAuthority(input.project, input.authorityDirectory)
  const base = async (): Promise<Document> => {
    const saved = await readJson(file)
    return saved === undefined ? initial() : document(saved)
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
      const next = document({...value, schemaVersion: 1, revision: (await base()).revision + 1})
      await authority.change({general: next.general.approvalMode,
        ...Object.fromEntries(entityTypes.map(type => [`type:${type}`, next.types[type]?.approvalMode]))})
      await save(file, {...next, general: withoutApproval(next.general),
        types: Object.fromEntries(Object.entries(next.types).map(([type, selected]) => [type, withoutApproval(selected!)]))})
      return read()
    }),
    readExecutor,
    updateExecutor: value => exclusive(file, async () => {
      const selected = selection(value.selection)
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
      const effective: {connectionId: string, model?: string, thoughtLevel?: string, approvalMode?: NonNullable<Selection["approvalMode"]>} = {connectionId: "codex"}
      const sources: {connectionId: Execution["sources"]["connectionId"], model?: Execution["sources"]["connectionId"], thoughtLevel?: Execution["sources"]["connectionId"], approvalMode?: Execution["sources"]["connectionId"]} = {connectionId: "general"}
      for (const [source, layer] of [["general", current.general], ["type", confirmed], ["executor", executorSelection], ["session", selected]] as const) {
        for (const key of fields) if (layer?.[key] !== undefined) {
          Object.assign(effective, {[key]: layer[key]!})
          sources[key] = source
        }
      }
      if (value.pinnedConnectionId !== undefined && executorSelection.connectionId === undefined && selected.connectionId === undefined) {
        effective.connectionId = value.pinnedConnectionId
        sources.connectionId = "native"
      }
      if (!current.connections.some(connection => connection.id === effective.connectionId)) throw new Error("Подключение native сессии недоступно в этой среде")
      return {selection: selected, executorSelection, effective, sources, connections: current.connections,
        approvalPolicyRevision: policy.revision,
        approvalCapabilities: {modes: authority.enabled ? ["ask", "scoped-autonomous"] : ["ask"], autoReview: false, scope: "assignment"}}
    },
  }
}
