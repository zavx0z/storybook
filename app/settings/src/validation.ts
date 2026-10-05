import type {StorybookAppSettings} from "../contract"

type Document = Awaited<ReturnType<StorybookAppSettings.Output["read"]>>
type ExecutorInput = Parameters<StorybookAppSettings.Output["readExecutor"]>[0]
type Selection = Awaited<ReturnType<StorybookAppSettings.Output["readExecutor"]>>
type Execution = Awaited<ReturnType<StorybookAppSettings.Output["resolve"]>>
type EntityType = NonNullable<ExecutorInput["subject"]["type"]>

export const entityTypes = ["Project", "Repo", "Domain", "Cluster", "Container", "Component"] as const
export const fields = ["connectionId", "model", "thoughtLevel"] as const
export const initial = (): Document => ({schemaVersion: 1, revision: 0,
  connections: [{id: "codex", provider: "codex", label: "Codex", enabled: true}], general: {connectionId: "codex"}, types: {}})

export function object(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw new TypeError("Недопустимая форма настроек исполнения")
  return input as Record<string, unknown>
}
export function selection(input: unknown): Selection {
  const value = object(input, fields)
  for (const key of fields) if (Object.hasOwn(value, key) && (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 256)) throw new TypeError(`Настройка ${key} должна быть непустой строкой`)
  if (value.connectionId !== undefined && value.connectionId !== "codex") throw new TypeError("Подключение не поддерживается: доступен Codex")
  return structuredClone(value) as Selection
}
export function document(input: unknown): Document {
  const value = object(input, ["schemaVersion", "revision", "connections", "general", "types"])
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) throw new TypeError("Повреждена версия настроек исполнения")
  if (!Array.isArray(value.connections) || value.connections.length !== 1) throw new TypeError("Каталог должен содержать установленное подключение Codex")
  const connection = object(value.connections[0], ["id", "provider", "label", "enabled"])
  if (connection.id !== "codex" || connection.provider !== "codex" || typeof connection.label !== "string" || !connection.label.trim() || connection.label.length > 128 || typeof connection.enabled !== "boolean") throw new TypeError("Неизвестное подключение исполнения")
  const types = {...object(value.types, entityTypes)}
  for (const key of Object.keys(types)) types[key] = selection(types[key])
  return {schemaVersion: 1, revision: Number(value.revision), connections: [connection as Execution["connections"][number]], general: selection(value.general), types}
}
