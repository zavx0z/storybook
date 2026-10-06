import type {Snapshot, ContextUsage} from "../contract/state"
import type {StorybookChatHistory} from "@zavx0z/storybook-chat-history"
import type {ExecutionSelection} from "../contract/execution"

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
  /** Подключение, которому принадлежит native session; старый sessionId принадлежит Codex. */
  connectionId?: string
  /** Явные настройки беседы; отсутствие отдельных значений сохраняет наследование. */
  executionSelection?: ExecutionSelection
  /** Существующие native настройки неизвестны: defaults среды не перезаписывают их автоматически. */
  preserveNativeSettings?: boolean
  /** Подтверждённые начальные native значения для возврата после удаления override. */
  executionBaseline?: ExecutionSelection
  cwd?: string
  /** Последний подтверждённо доставленный контекст, связанный с provider session. */
  environmentContext?: string
  /** Начатая задача: durable start и dequeue сохраняются одним commit. */
  activeRequest?: string
  /** Только identity незавершённых решений; исходные запросы лежат в timeline. */
  pendingPermissions?: string[]
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
