import type {TimelineItem} from "./timeline"

/** Общий контракт чтения истории беседы, независимый от storage и процесса агента. */
export declare namespace StorybookChatHistory {
  /** Неизвестное сериализованное значение; reader проверяет каждую запись и ACP payload. */
  type Input = unknown
  /** Предметная timeline с проверенными identity, порядком и штатным ACP содержимым. */
  type Output = readonly TimelineItem[]
}
