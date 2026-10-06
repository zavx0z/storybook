import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"

type Session = StorybookChatSession.Output
type Page = Awaited<ReturnType<Session["displayHistory"]>>
type Body = Awaited<ReturnType<Session["historyItem"]>>
type Detail = Awaited<ReturnType<Session["historyDetail"]>>
export type DisplayBody = (Body["entry"] & Readonly<{continuation?: Body["continuation"], sourceBytes?: number, historyRevision?: number, terminal?: Body["terminal"]}>) | Readonly<{kind: "group", id: string}> | Readonly<{kind: "detail", id: string, sourceId?: string, evidenceId?: string, detail: Detail}>

type Evidence = Awaited<ReturnType<Session["historyEvidence"]>>

/** Одна resident строка: малый заголовок и только запрошенное сейчас тело. */
export type HistoryRow = Readonly<{
  header: Page["items"][number] | Awaited<ReturnType<Session["groupHistory"]>>["items"][number]
  visible?: boolean
  body?: DisplayBody | undefined
  continuation?: Body["continuation"]
  sourceBytes?: number
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
