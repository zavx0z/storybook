import type {AiWorkspace} from "@zavx0z/ai-workspace"

/**
Исполнимая возможность с описанием от владельца реализации.

@property execute - Получает аргументы и контекст одного вызова.
Signal отменяет ожидание исполнителя; progress сообщает промежуточные состояния
без изменения результата. Существующие синхронные инструменты используют только input.
*/
type Tool = Readonly<{
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  annotations: Readonly<{readOnlyHint: boolean, destructiveHint: boolean, idempotentHint?: boolean}>
  execute(input: unknown, context?: Readonly<{
    signal: AbortSignal
    onProgress?(progress: Readonly<Record<string, unknown>>): void | Promise<void>
  }>): unknown | Promise<unknown>
}>

/** Общие инструменты Package и явные расширения предметной сущности. */
export declare namespace StorybookPackageMcpTools {
  /**
  Контекст назначает хост; расширения добавляет предметный владелец.
  @property workspace - Неизменяемая файловая область подключения.
  @property [extensions] - Дополнительные исполнители с уникальными именами.
  */
  type Input = Readonly<{workspace: AiWorkspace.Output, extensions?: readonly Tool[]}>
  /** Исполнители замкнуты на одну область и не принимают root от модели. */
  type Output = readonly Tool[]
}
