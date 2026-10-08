import type {ProviderConnection} from "@zavx0z/provider-connection"
import type {ProviderConnectionChromeStudio} from "@zavx0z/provider-connection-chrome-studio"
import type {ProviderConnectionCapsule} from "@zavx0z/provider-connection-capsule"

/** Явный выбор; отсутствие поля возвращает наследование соответствующего значения. */
export type ApprovalMode = "ask" | "scoped-autonomous"

export type ExecutionSelection = Readonly<{connectionId?: string, model?: string, thoughtLevel?: string, approvalMode?: ApprovalMode}>

/** Источник каждого независимо наследуемого значения исполнения. */
export type ExecutionSource = "general" | "type" | "executor" | "session" | "native"

/** Адрес Ollama на этой машине; SSH запускается только отдельными аргументами. */
export type OllamaEndpoint = ProviderConnection.Input

/** Capsule Studio на машине ACP-исполнителя и уже запущенный профиль выбранного сервиса. */
export type CapsuleEndpoint = ProviderConnectionCapsule.Input

/** Машина исполнения Capsule: Studio, Docker и ACP работают вместе. Пути относятся к удалённой машине. */
export type CapsuleSsh = Readonly<{
  host: string
  user?: string
  port?: number
  /** Абсолютный каталог установленного Repo Provider. */
  providerRoot: string
  /** Абсолютный каталог постоянных данных Provider; суффикс Project и подключения назначает среда. */
  storageRoot: string
  /** Контекст Docker только удалённого ACP-процесса; default context машины не изменяется. */
  dockerContext?: string
}>

/** Реальное подключение среды; credentials и команды запуска в каталог не входят. */
export type ExecutionConnection = Readonly<{id: string, label: string, enabled: boolean}> & (
  Readonly<{provider: "codex"}> | Readonly<{provider: "ollama", endpoint: OllamaEndpoint}> |
  Readonly<{provider: "capsule", endpoint: CapsuleEndpoint, ssh?: CapsuleSsh}> |
  Readonly<{provider: "chrome-studio", endpoint: ProviderConnectionChromeStudio.Input, ssh?: Omit<CapsuleSsh, "dockerContext">}>
)

/** Выбранные настройки беседы и результат разрешения до обращения к исполнителю. */
export type ExecutionResolution = Readonly<{
  selection: ExecutionSelection
  executorSelection: ExecutionSelection
  /** Закреплённое подключение существующей native сессии; новый чат не содержит поля. */
  pinnedConnectionId?: string
  effective: ExecutionSelection & Readonly<{connectionId: string}>
  sources: Readonly<{connectionId: ExecutionSource, model?: ExecutionSource, thoughtLevel?: ExecutionSource, approvalMode?: ExecutionSource}>
  /** Самостоятельность не расширяет назначение. Проверка host действий моделью пока недоступна. */
  approvalCapabilities?: Readonly<{modes: readonly ApprovalMode[], autoReview: false, scope: "assignment"}>
  /** Ревизия доверенных решений человека, зафиксированная перед turn. */
  approvalPolicyRevision?: number
  connections: readonly ExecutionConnection[]
}>
