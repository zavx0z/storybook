import readHistory from "@zavx0z/storybook-chat-history"
import {createHistoryWindow} from "@zavx0z/chat/history"
import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"
import type {StorybookChatView} from "@zavx0z/storybook-chat-view"

type Snapshot = Awaited<ReturnType<StorybookChatSession.Output["read"]>>
type Page = Awaited<ReturnType<StorybookChatSession.Output["history"]>>
type Body = Awaited<ReturnType<StorybookChatSession.Output["historyItem"]>>
type Evidence = Awaited<ReturnType<StorybookChatSession.Output["historyEvidence"]>>
type Header = Page["items"][number]
type View = StorybookChatView.Input["history"]
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0

/** Связывает общий frontend Chat с transport и предметными записями Storybook. */
export function createChatHistoryWindow(input: Readonly<{
  read(operation: string, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
  changed(): void
}>) {
  let selected: Snapshot | null = null
  const identity = (id: string) => {
    if (selected === null || selected.id !== id) throw new Error("Выбрана другая беседа")
    return {chatId: id, sessionId: id, executorId: selected.executorId}
  }
  const controller = createHistoryWindow<Header, Body["entry"], Evidence["items"][number]>({
    source: {
      async readPage(id, query, signal) {
        const page = await input.read("history", {...identity(id), query}, signal) as Page
        return {...page, conversationId: page?.chatId}
      },
      async readBody(id, entryId, signal) {
        const body = await input.read("history-item", {...identity(id), id: entryId}, signal) as Body
        return {...body, conversationId: body?.chatId}
      },
      async readEvidence(id, entryId, query, signal) {
        const page = await input.read("history-evidence", {...identity(id), id: entryId, query}, signal) as Evidence
        return {...page, conversationId: page?.chatId}
      },
    },
    isOrdinary: header => header.kind === "message" && header.role !== "thought" && header.purpose !== "command",
    validateHeader: header => integer(header.sequence) && ["message", "context", "tool", "turn", "event"].includes(header.kind) && ["live", "local", "replay", "legacy"].includes(header.origin),
    validateBody(body, header) {
      const entry = readHistory([body])[0]!
      if (entry.id !== header.id || entry.kind !== header.kind) throw new Error("Тело другой записи истории")
      return entry
    },
    changed: input.changed,
  })
  return {
    ...controller,
    accept(snapshot: Snapshot) {
      selected = snapshot
      controller.accept({id: snapshot.id, scope: snapshot.executorId, history: snapshot.history})
    },
    getSnapshot(): View {
      const {conversationId, rows, ...value} = controller.getSnapshot()
      return {...value, chatId: conversationId, rows: rows.map(row => {
        const {evidence, ...entry} = row
        if (evidence === undefined) return entry
        const {conversationId: evidenceConversation, ...details} = evidence
        return {...entry, evidence: {...details, chatId: evidenceConversation}}
      })}
    },
    dispose() {controller.dispose(); selected = null},
  }
}
