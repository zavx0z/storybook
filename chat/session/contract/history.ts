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
  eventType?: string
  phase?: string
  status?: string
  state?: "started" | "completed" | "cancelled" | "failed"
  stopReason?: string
  error?: string
  receivedAt?: string
  bodyBytes: number
  evidenceCount: number
}>

/** Ordinal — устойчивое место записи; sequence также учитывает её потоковые изменения. */
export type HistoryQuery = Readonly<{
  projectionRevision?: number
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
Replay собственного bootstrap с единственным точным соответствием supplied context
и canonical user content раскрывается как context того же requestId. Вопрос остаётся
в локальном сообщении; исходные replay blocks доступны через evidence.
Текстовое image echo Codex сопоставляется только с точным начатым локальным input,
содержащим image. Проекция context возвращает его исходные typed blocks, а не data URL как текст.
*/
export type HistoryBody = Readonly<{
  chatId: string
  revision: number
  id: string
  bytes: number
  entry: Item
  terminal?: HistoryTerminalPage
  detail?: HistoryDetailPage
  continuation?: HistoryContentCursor
  sourceBytes?: number
  evidenceCount: number
}>

export type HistoryEvidence = Readonly<{
  id: string
  sequence: number
  origin: Item["origin"]
  batchId?: string
  receivedAt?: string
  requestId?: string
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

/** Одна группа служебных событий между canonical user messages; assistant её не разделяет. */
export type HistoryGroup = Readonly<{
  id: string
  kind: "group"
  origin: "local"
  ordinal: number
  sequence: number
  revision: number
  bodyBytes: 0
  evidenceCount: number
  memberCount: number
  userId: string | null
  lastSequence: number
  receivedAt?: string
  status?: string
  title: string
}>

/** Верхний список считает видимые сообщения и группы, а не raw events. */
export type HistoryDisplayPage = Omit<HistoryPage, "items"> & Readonly<{
  items: readonly (HistoryEntry | HistoryGroup)[]
  rawTotal: number
  projectionRevision: number
}>

/** Малый заголовок конкретного occurrence; entryId связывает обновления одного инструмента. */
export type HistoryOccurrence = HistoryEntry & Readonly<{
  entryId: string
  evidenceId?: string
  groupId: string
  requestId?: string
  receivedAt?: string
}>
export type HistoryGroupPage = Omit<HistoryPage, "items"> & Readonly<{
  groupId: string
  projectionRevision: number
  items: readonly HistoryOccurrence[]
}>

/** Offset задаётся в Unicode codepoints текстового блока; оригинал никогда не обрезается. */
export type HistoryContentCursor = Readonly<{block: number; offset: number}>
export type HistoryContentQuery = Readonly<{cursor?: HistoryContentCursor; maxBytes?: number}>
export type HistoryContentPage = Readonly<{
  chatId: string
  id: string
  revision: number
  bytes: number
  sourceBytes: number
  content: readonly Extract<Item, {kind: "message"}>["content"][number][]
  next: HistoryContentCursor | null
}>

/** Порция точного JSON крупного результата; offset в Unicode codepoints сериализованного текста. */
export type HistoryDetailPage = Readonly<{
  chatId: string
  id: string
  revision: number
  text: string
  bytes: number
  sourceBytes: number
  next: number | null
}>

/** Offset в Unicode codepoints одного точного terminal delta. */
export type HistoryTerminalCursor = Readonly<{ordinal: number; offset: number; evidenceId?: string}>
export type HistoryTerminalQuery = Readonly<{cursor?: HistoryTerminalCursor; maxBytes?: number}>
export type HistoryTerminalPage = Readonly<{
  chatId: string
  id: string
  revision: number
  terminalId?: string
  cwd?: string
  chunks: readonly Readonly<{sequence: number; stream: "stdout" | "stderr" | "combined"; text: string}>[]
  exit?: Readonly<{code: number | null; signal: string | null}>
  bytes: number
  next: HistoryTerminalCursor | null
}>
