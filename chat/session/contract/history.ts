import type {StorybookChatHistory} from "@zavx0z/storybook-chat-history"

type Item = StorybookChatHistory.Output[number]

/** Состояние дисковой истории; не содержит сообщений или растущего индекса. */
export type HistoryState = Readonly<{revision: number; total: number; lastSequence: number}>

/** Малый заголовок записи. Содержимое и raw evidence читаются отдельно. */
export type HistoryEntry = Readonly<{
  id: string
  ordinal: number
  sequence: number
  revision: number
  kind: Item["kind"]
  origin: Item["origin"]
  role?: "user" | "assistant" | "system" | "thought"
  purpose?: "command"
  title?: string
  status?: string
  state?: "started" | "completed" | "cancelled" | "failed"
  stopReason?: string
  error?: string
  bodyBytes: number
  evidenceCount: number
}>

/** Ordinal — устойчивое место записи; sequence также учитывает её потоковые изменения. */
export type HistoryQuery = Readonly<{
  before?: number
  after?: number
  around?: number
  limit?: number
  maxBytes?: number
}>

/** Только ограниченная страница заголовков; отсутствие cursor означает границу истории. */
export type HistoryPage = Readonly<{
  chatId: string
  revision: number
  total: number
  start: number
  items: readonly HistoryEntry[]
  before: number | null
  after: number | null
}>

/**
Проекция тела одной записи. Raw updates не дублируются в entry, а читаются отдельной
страницей evidence. Источник на диске сохраняет исходные блоки и события без потерь.
*/
export type HistoryBody = Readonly<{
  chatId: string
  revision: number
  id: string
  bytes: number
  entry: Item
  evidenceCount: number
}>

export type HistoryEvidence = Readonly<{
  id: string
  sequence: number
  origin: Item["origin"]
  batchId?: string
  update: unknown
}>

/** Raw evidence имеет собственный ограниченный диапазон. */
export type HistoryEvidencePage = Readonly<{
  chatId: string
  id: string
  revision: number
  total: number
  start: number
  items: readonly HistoryEvidence[]
  before: number | null
  after: number | null
}>
