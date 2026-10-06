/** Явный выбор; отсутствие поля возвращает наследование соответствующего значения. */
export type ApprovalMode = "ask" | "scoped-autonomous"

export type ExecutionSelection = Readonly<{connectionId?: string, model?: string, thoughtLevel?: string, approvalMode?: ApprovalMode}>

/** Источник каждого независимо наследуемого значения исполнения. */
export type ExecutionSource = "general" | "type" | "executor" | "session" | "native"

/** Реальное подключение среды; credentials и команды запуска в каталог не входят. */
export type ExecutionConnection = Readonly<{id: string, provider: "codex", label: string, enabled: boolean}>

/** Выбранные настройки беседы и результат разрешения до обращения к исполнителю. */
export type ExecutionResolution = Readonly<{
  selection: ExecutionSelection
  executorSelection: ExecutionSelection
  effective: ExecutionSelection & Readonly<{connectionId: string}>
  sources: Readonly<{connectionId: ExecutionSource, model?: ExecutionSource, thoughtLevel?: ExecutionSource, approvalMode?: ExecutionSource}>
  /** Самостоятельность не расширяет назначение. Проверка host действий моделью пока недоступна. */
  approvalCapabilities?: Readonly<{modes: readonly ApprovalMode[], autoReview: false, scope: "assignment"}>
  /** Ревизия доверенных решений человека, зафиксированная перед turn. */
  approvalPolicyRevision?: number
  connections: readonly ExecutionConnection[]
}>
