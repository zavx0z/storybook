import type {AiWorkspace} from "@zavx0z/ai-workspace"

/** Исполнимая возможность с описанием от владельца реализации. */
type Tool = Readonly<{
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  annotations: Readonly<{readOnlyHint: boolean, destructiveHint: boolean}>
  execute(input: unknown): unknown | Promise<unknown>
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
