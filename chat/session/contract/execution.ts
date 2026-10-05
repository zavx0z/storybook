/** Явный выбор; отсутствие поля возвращает наследование соответствующего значения. */
export type ExecutionSelection = Readonly<{connectionId?: string, model?: string, thoughtLevel?: string}>

/** Источник каждого независимо наследуемого значения исполнения. */
export type ExecutionSource = "general" | "type" | "executor" | "session" | "native"

/** Реальное подключение среды; credentials и команды запуска в каталог не входят. */
export type ExecutionConnection = Readonly<{id: string, provider: "codex", label: string, enabled: boolean}>

/** Выбранные настройки беседы и результат разрешения до обращения к исполнителю. */
export type ExecutionResolution = Readonly<{
  selection: ExecutionSelection
  executorSelection: ExecutionSelection
  effective: ExecutionSelection & Readonly<{connectionId: string}>
  sources: Readonly<{connectionId: ExecutionSource, model?: ExecutionSource, thoughtLevel?: ExecutionSource}>
  connections: readonly ExecutionConnection[]
}>
