import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"

type Session = StorybookChatSession.Output
type Page = Awaited<ReturnType<Session["history"]>>
type Body = Awaited<ReturnType<Session["historyItem"]>>
type Evidence = Awaited<ReturnType<Session["historyEvidence"]>>

/** Одна resident строка: малый заголовок и только запрошенное сейчас тело. */
export type HistoryRow = Readonly<{
  header: Page["items"][number]
  body?: Body["entry"] | undefined
  evidence?: Evidence | undefined
  expanded: boolean
  loading: boolean
  error?: string | undefined
}>

/** Ограниченное окно. Глубокая история не передаётся в props и не удерживается DOM. */
export type HistoryWindow = Readonly<{
  chatId: string | null
  revision: number
  total: number
  rows: readonly HistoryRow[]
  before: number | null
  after: number | null
  unread: number
  following: boolean
  loading: boolean
  error?: string | undefined
}>

/** Visibility относится к измеренному viewport; expansion отдельно разрешает детали. */
export type HistoryViewport = Readonly<{
  ids: readonly string[]
  nearStart: boolean
  nearEnd: boolean
  following: boolean
}>
