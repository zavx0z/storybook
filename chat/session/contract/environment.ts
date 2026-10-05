import type {StorybookChatHistory} from "@zavx0z/storybook-chat-history"

type Item = StorybookChatHistory.Output[number]
type Content = Extract<Item, {kind: "message"}>["content"]

/** Полное сообщение-команда: маршрутизацию и identity вызова определяет среда. */
export type Command = Readonly<{name: string, arguments: Readonly<Record<string, unknown>>}>

/**
Подготовленное хостом окружение сохраняемого исполнителя.
Содержимое передаётся перед первой задачей в новой provider session и при изменении
контекста. execute доставляет одну команду тому же исполнителю и возвращает точный
результат либо предметную ошибку. Транспортный отказ не повторяет команду автоматически.
dispose освобождает назначение этой локальной сессии при idle release, отказе,
переносе либо завершении. Новое подключение подготавливает окружение заново,
сохраняя logical executorId и локальный sessionId.
*/
export type Environment = Readonly<{
  content: Content
  execute(command: Command, signal: AbortSignal): Promise<Content>
  dispose(): void
}>

/** Подготовка окружения не запускает генерацию и не раскрывает секреты модели. */
export type EnvironmentInput = Readonly<{
  executorId: string
  /** Локальная сессия агента; определяет время жизни назначения окружения. */
  sessionId: string
  executorLabel: string
  address: string
  onUpdate(update: Extract<Item, {kind: "tool"}>["call"]): void | Promise<void>
}>
