import type {StorybookAppSettings} from "../contract"
import {isAbsolute, normalize} from "node:path"

type Document = Awaited<ReturnType<StorybookAppSettings.Output["read"]>>
type ExecutorInput = Parameters<StorybookAppSettings.Output["readExecutor"]>[0]
type Selection = Awaited<ReturnType<StorybookAppSettings.Output["readExecutor"]>>
type Execution = Awaited<ReturnType<StorybookAppSettings.Output["resolve"]>>
type EntityType = NonNullable<ExecutorInput["subject"]["type"]>

export const entityTypes = ["Project", "Repo", "Domain", "Cluster", "Container", "Component"] as const
export const fields = ["connectionId", "model", "thoughtLevel", "approvalMode"] as const
export const initial = (): Document => ({schemaVersion: 1, revision: 0,
  connections: [{id: "codex", provider: "codex", label: "Codex", enabled: true}], general: {connectionId: "codex"}, types: {}})

export function object(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw new TypeError("Недопустимая форма настроек исполнения")
  return input as Record<string, unknown>
}
export function selection(input: unknown): Selection {
  const value = object(input, fields)
  for (const key of fields) if (Object.hasOwn(value, key) && (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 256)) throw new TypeError(`Настройка ${key} должна быть непустой строкой`)
  if (value.approvalMode !== undefined && value.approvalMode !== "ask" && value.approvalMode !== "scoped-autonomous") throw new TypeError("Режим подтверждений не поддерживается")
  return structuredClone(value) as Selection
}
export function document(input: unknown, allowMissingConnections = false): Document {
  const value = object(input, ["schemaVersion", "revision", "connections", "general", "types"])
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) throw new TypeError("Повреждена версия настроек исполнения")
  if (!Array.isArray(value.connections) || value.connections.length < 1 || value.connections.length > 128) throw new TypeError("Нужен непустой каталог подключений")
  const connections = value.connections.map(validateConnection)
  if (new Set(connections.map(connection => connection.id)).size !== connections.length) throw new TypeError("Identity подключений должны быть уникальными")
  const types = {...object(value.types, entityTypes)}
  for (const key of Object.keys(types)) types[key] = selection(types[key])
  const general = selection(value.general)
  if (!allowMissingConnections) for (const layer of [general, ...Object.values(types) as Selection[]]) validateSelectionConnection(layer, connections)
  return {schemaVersion: 1, revision: Number(value.revision), connections, general, types}
}

export function validateSelectionConnection(layer: Selection, connections: Execution["connections"]): void {
  if (layer.connectionId !== undefined && !connections.some(connection => connection.id === layer.connectionId)) throw new TypeError("Неизвестное подключение исполнения")
}

export function validateConnection(input: unknown): Execution["connections"][number] {
  const value = object(input, ["id", "provider", "label", "enabled", "endpoint", "ssh"])
  if (typeof value.id !== "string" || !value.id.trim() || value.id.length > 256 || typeof value.label !== "string" || !value.label.trim() || value.label.length > 128 || typeof value.enabled !== "boolean") throw new TypeError("Неизвестное подключение исполнения")
  if (value.provider === "codex") {
    if (value.ssh !== undefined) throw new TypeError("Удалённое исполнение поддерживается для браузерных провайдеров")
    if (value.endpoint !== undefined) throw new TypeError("Codex не принимает endpoint подключения")
    return structuredClone(value) as Execution["connections"][number]
  }
  if (value.provider === "capsule" || value.provider === "chrome-studio") {
    const endpoint = object(value.endpoint, ["url", "profile", "service"])
    if (typeof endpoint.url !== "string" || endpoint.url.length > 2048 || endpoint.url !== endpoint.url.trim()) throw new TypeError("Нужен HTTP-адрес браузерной Studio на машине исполнения")
    let url: URL
    try {url = new URL(endpoint.url)} catch {throw new TypeError("Нужен HTTP-адрес браузерной Studio на машине исполнения")}
    if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || endpoint.url.includes("?") || endpoint.url.includes("#")) throw new TypeError("браузерной Studio подключается только по локальному origin без пути, credentials, query или fragment")
    if (typeof endpoint.profile !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(endpoint.profile)) throw new TypeError("Укажите имя уже запущенного профиля браузера")
    if (endpoint.service !== "qwen" && endpoint.service !== "deepseek" && endpoint.service !== "chatgpt") throw new TypeError("Браузерный сервис не поддерживается")
    if (value.ssh !== undefined) {
      const ssh = object(value.ssh, ["host", "user", "port", "providerRoot", "storageRoot", ...(value.provider === "capsule" ? ["dockerContext"] : [])])
      validateSsh(ssh)
      for (const field of ["providerRoot", "storageRoot"]) {
        const path = ssh[field]
        if (typeof path !== "string" || path.length > 4096 || /[\u0000-\u001f\u007f]/u.test(path) || !isAbsolute(path) || normalize(path) !== path) throw new TypeError("Укажите абсолютные нормализованные пути Provider на машине исполнения")
      }
      if (ssh.dockerContext !== undefined && (typeof ssh.dockerContext !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/u.test(ssh.dockerContext))) throw new TypeError("Недопустимый контекст Docker")
    }
    return structuredClone(value) as Execution["connections"][number]
  }
  if (value.ssh !== undefined) throw new TypeError("Удалённое исполнение поддерживается для браузерных провайдеров")
  if (value.provider !== "ollama") throw new TypeError("Провайдер не поддерживается")
  const endpoint = object(value.endpoint, ["url", "ssh"])
  if (typeof endpoint.url !== "string" || endpoint.url.length > 2048 || endpoint.url !== endpoint.url.trim()) throw new TypeError("Нужен HTTP-адрес Ollama")
  let url: URL
  try {url = new URL(endpoint.url)} catch {throw new TypeError("Нужен HTTP-адрес Ollama")}
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || endpoint.url.includes("?") || endpoint.url.includes("#")) throw new TypeError("Адрес Ollama не должен содержать credentials, query или fragment")
  if (endpoint.ssh !== undefined) {
    if (url.protocol !== "http:") throw new TypeError("SSH-туннель принимает только HTTP адрес сервиса")
    const ssh = object(endpoint.ssh, ["host", "user", "port"])
    validateSsh(ssh)
  }
  return structuredClone(value) as Execution["connections"][number]
}

function validateSsh(ssh: Record<string, unknown>): void {
  if (typeof ssh.host !== "string" || ssh.host.length > 253 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(ssh.host)) throw new TypeError("Недопустимый SSH host")
  if (ssh.user !== undefined && (typeof ssh.user !== "string" || ssh.user.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(ssh.user))) throw new TypeError("Недопустимый SSH user")
  if (ssh.port !== undefined && (typeof ssh.port !== "number" || !Number.isInteger(ssh.port) || ssh.port < 1 || ssh.port > 65535)) throw new TypeError("Недопустимый SSH port")
}
