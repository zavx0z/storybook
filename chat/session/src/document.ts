import type {Snapshot, ContextUsage} from "../contract/state"
import type {StorybookChatHistory} from "@zavx0z/storybook-chat-history"

type TimelineItem = StorybookChatHistory.Output[number]

export type Document = {
  schemaVersion: 2
  id: string
  executorId: string
  executorLabel: string
  /** Имя локальной сессии; не меняет identity агента. */
  sessionLabel?: string
  sessionLabelSource?: "auto" | "manual"
  /** Первое пользовательское сообщение уже определило auto имя. */
  sessionLabelAssigned?: boolean
  address: string
  sessionId?: string
  cwd?: string
  /** Последний подтверждённо доставленный контекст, связанный с provider session. */
  environmentContext?: string
  /** Начатая задача: durable start и dequeue сохраняются одним commit. */
  activeRequest?: string
  /** Последняя управляющая версия сохраняется при освобождении resident state. */
  controlVersion?: number
  timeline: TimelineItem[]
  /** Очередь содержит только ссылки на canonical messages, без второй копии content. */
  pending: string[]
  historyComplete: boolean
  usage?: ContextUsage
  status: Snapshot["status"]
  error: string | null
}
