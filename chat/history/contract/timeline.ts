import type {ContentBlock, SessionUpdate} from "@agentclientprotocol/sdk"

/** Реально переданное содержимое ACP; контекст провайдера из него не достраивается. */
export type Content = ContentBlock

type Update = SessionUpdate

/** Источник записи; replay без provider identity остаётся явно различимым. */
export type Origin = "local" | "live" | "replay" | "legacy"

/** Устойчивый ключ записи и её первоначальное место в общей истории. */
type Entry = Readonly<{
  id: string
  sequence: number
  origin: Origin
  /** Одна загрузка replay; не подменяет identity отдельного provider event. */
  batchId?: string
}>

/** Полученное событие инструмента; sequence сохраняет его место среди сообщений. */
export type ToolEvent = Entry & Readonly<{
  update: Extract<Update, {sessionUpdate: "tool_call" | "tool_call_update"}>
}>

/**
История беседы с готовыми предметными записями для представления.
ContentBlock сохраняется в штатной форме ACP. message объединяет chunks одной
подтверждённой provider identity; без неё границу определяет последовательность
live-событий одного turn. Replay без identity получает отдельную запись и diagnostic.
Tool содержит актуальное накопленное состояние и исходные изменения как свидетельства.
*/
export type TimelineItem = Entry & (
  | Readonly<{
    kind: "message"
    role: "user" | "assistant" | "system" | "thought"
    content: readonly Content[]
    providerMessageId?: string
    diagnostic?: string
    /** Подтверждённая команда окружения остаётся в истории и свёрнута в представлении. */
    purpose?: "command"
    /** Исходные chunks сохраняют metadata и порядок, не создавая отдельные строки UI. */
    updates?: readonly (Entry & Readonly<{update: Extract<Update, {sessionUpdate: "agent_message_chunk" | "user_message_chunk" | "agent_thought_chunk"}>}>)[]
  }>
  | Readonly<{
    kind: "tool"
    toolCallId: string
    call: Extract<Update, {sessionUpdate: "tool_call" | "tool_call_update"}>
    updates: readonly ToolEvent[]
  }>
  | Readonly<{
    kind: "context"
    content: readonly Content[]
    requestId?: string
  }>
  | Readonly<{
    kind: "turn"
    requestId: string
    state: "started" | "completed" | "cancelled" | "failed"
    stopReason?: string
    error?: string
  }>
  | Readonly<{
    kind: "event"
    update: Update
  }>
)
