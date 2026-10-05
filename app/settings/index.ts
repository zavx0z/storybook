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
  const read = async (): Promise<Document> => {
    const saved = await readJson(file)
    return saved === undefined ? initial() : document(saved)
  }
  const readExecutor = async (value: ExecutorInput): Promise<Selection> => {
    const saved = await readJson(executorFile(value))
    if (saved === undefined) return {}
    const record = object(saved, ["schemaVersion", "executorId", "selection"])
    if (record.schemaVersion !== 1 || record.executorId !== value.executorId) throw new TypeError("Повреждена identity настроек исполнителя")
    return selection(record.selection)
  }
  return {
    read,
    update: value => exclusive(file, async () => {
      const current = await read()
      if (value.revision !== current.revision) throw new Error("Настройки изменились: обновите снимок перед сохранением")
      const next = document({...value, schemaVersion: 1, revision: current.revision + 1})
      await save(file, next)
      return next
    }),
    readExecutor,
    updateExecutor: value => exclusive(file, () => save(executorFile(value), {schemaVersion: 1, executorId: value.executorId, selection: selection(value.selection)})),
    async resolve(value) {
      const current = await read()
      const selected = selection(value.selection)
      const executorSelection = value.executorSelection === undefined ? await readExecutor(value) : selection(value.executorSelection)
      const confirmed = entityTypes.includes(value.subject.type as EntityType) ? current.types[value.subject.type!] : undefined
      const effective: {connectionId: string, model?: string, thoughtLevel?: string} = {connectionId: "codex"}
      const sources: {connectionId: Execution["sources"]["connectionId"], model?: Execution["sources"]["connectionId"], thoughtLevel?: Execution["sources"]["connectionId"]} = {connectionId: "general"}
      for (const [source, layer] of [["general", current.general], ["type", confirmed], ["executor", executorSelection], ["session", selected]] as const) {
        for (const key of fields) if (layer?.[key] !== undefined) {
          effective[key] = layer[key]!
          sources[key] = source
        }
      }
      if (value.pinnedConnectionId !== undefined && executorSelection.connectionId === undefined && selected.connectionId === undefined) {
        effective.connectionId = value.pinnedConnectionId
        sources.connectionId = "native"
      }
      if (!current.connections.some(connection => connection.id === effective.connectionId)) throw new Error("Подключение native сессии недоступно в этой среде")
      return {selection: selected, executorSelection, effective, sources, connections: current.connections}
    },
  }
}
