import type {ContentBlock, SessionUpdate, RequestPermissionRequest} from "@agentclientprotocol/sdk"

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
  /** Время приёма средой; старым событиям время не приписывается. */
  receivedAt?: string
  /** Одна загрузка replay; не подменяет identity отдельного provider event. */
  batchId?: string
}>

/** Полученное событие инструмента; sequence сохраняет его место среди сообщений. */
export type ToolEvent = Entry & Readonly<{
  update: Extract<Update, {sessionUpdate: "tool_call" | "tool_call_update"}>
}>

/**
История беседы с готовыми предметными записями для представления.
Публичные блоки сохраняют форму ACP; дисковый архив заменяет бинарные данные
обратимыми ссылками и материализует wire payload только перед отправкой. message объединяет chunks одной
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
    /** Решение относится к конкретному запросу и не является повторяемой командой. */
    kind: "permission"
    permissionId: string
    requestId: string
    requestHash: string
    source: "provider" | "environment"
    phase: "requested" | "decided" | "cancelled" | "interrupted"
    title: string
    request?: RequestPermissionRequest
    optionId?: string
    actor?: "user" | "policy"
    /** Причина технического отказа; полный запрос остаётся в requested записи. */
    error?: string
    policy?: Readonly<{mode: "ask" | "scoped-autonomous", revision?: number}>
  }>
  | Readonly<{
    kind: "event"
    update: Update
  }>
)
