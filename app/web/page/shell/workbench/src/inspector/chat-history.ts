import readHistory from "@zavx0z/storybook-chat-history"
import {createHistoryWindow, createHistoryResidencyBudget, type HistoryController} from "@zavx0z/chat/history"
import type {StorybookChatSession, HistoryGroup, HistoryOccurrence} from "@zavx0z/storybook-chat-session"
import type {StorybookChatView} from "@zavx0z/storybook-chat-view"

type Session = StorybookChatSession.Output
type Snapshot = Awaited<ReturnType<Session["read"]>>
type Page = Awaited<ReturnType<Session["displayHistory"]>>
type GroupPage = Awaited<ReturnType<Session["groupHistory"]>>
type Body = Awaited<ReturnType<Session["historyItem"]>>
type Detail = Awaited<ReturnType<Session["historyDetail"]>>
type Evidence = Awaited<ReturnType<Session["historyEvidence"]>>
type Header = Page["items"][number]
type View = StorybookChatView.Input["history"]
type DisplayBody = NonNullable<View["rows"][number]["body"]>
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const kinds = ["message", "context", "tool", "turn", "event", "permission", "group"]
const validateHeader = (header: Header) => integer(header.sequence) && kinds.includes(header.kind) && ["live", "local", "replay", "legacy"].includes(header.origin)
function validateBody(body: DisplayBody, header: Header): DisplayBody {
  if (body.id !== header.id) throw new Error("Тело другой записи истории")
  if (body.kind === "group") {if (header.kind !== "group") throw new Error("Группа другой записи"); return body}
  if (body.kind === "detail") return body
  const entry = readHistory([body])[0]!
  if (entry.kind !== header.kind) throw new Error("Тело другого вида истории")
  return body
}
function projectedBody(body: Body, sourceId = body.id, evidenceId?: string): DisplayBody {
  if (body.detail && !body.terminal) return {kind: "detail", id: body.id, sourceId, ...(evidenceId === undefined ? {} : {evidenceId}), detail: body.detail}
  return {...body.entry, historyRevision: body.revision, ...(body.copyRequiresSource ? {copyRequiresSource: true} : {}), ...(body.terminal === undefined ? {} : {terminal: body.terminal}), ...(body.continuation === undefined ? {} : {continuation: body.continuation}),
    ...(body.sourceBytes === undefined ? {} : {sourceBytes: body.sourceBytes})}
}

/** Предметная display/group проекция поверх общего bounded controller. */
export function createChatHistoryWindow(input: Readonly<{
  read(operation: string, body: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
  changed(): void
}>) {
  let selected: Snapshot | null = null
  const residencyBudget = createHistoryResidencyBudget()
  const groups = new Set<HistoryController<HistoryOccurrence, DisplayBody, unknown>>()
  const identity = (id: string) => {
    if (selected === null || selected.id !== id) throw new Error("Выбрана другая беседа")
    return {chatId: id, sessionId: id, executorId: selected.executorId}
  }
  const readBody = async (chatId: string, header: Header | HistoryOccurrence, signal: AbortSignal, groupId?: string) => {
    if (header.kind === "group") return {conversationId: chatId, id: header.id, revision: header.revision, bytes: 0,
      entry: {kind: "group" as const, id: header.id}, evidenceCount: 0}
    const sourceId = "entryId" in header ? header.entryId : header.id
    const evidenceId = "evidenceId" in header ? header.evidenceId : undefined
    if (header.bodyBytes > 512 * 1024 && header.kind !== "tool" && (evidenceId !== undefined || header.kind !== "message" && header.kind !== "context")) {
      const detail = await input.read("history-detail", {...identity(chatId), id: sourceId, query: {evidenceId}}, signal) as Detail
      if (detail.chatId !== chatId || detail.id !== sourceId || typeof detail.text !== "string" || !integer(detail.revision) || !integer(detail.bytes) || detail.bytes > 512 * 1024) throw new Error("Некорректная порция результата")
      return {conversationId: detail.chatId, id: header.id, revision: header.revision, bytes: detail.bytes,
        entry: {kind: "detail" as const, id: header.id, sourceId, ...(evidenceId === undefined ? {} : {evidenceId}), detail}, evidenceCount: 0}
    }
    const body = await input.read(groupId ? "history-group-item" : "history-item", {...identity(chatId), id: header.id,
      ...(groupId === undefined ? {} : {groupId})}, signal) as Body
    return {...body, conversationId: body?.chatId, entry: projectedBody(body, sourceId, evidenceId)}
  }
  let controller: HistoryController<Header, DisplayBody, Evidence["items"][number]>
  let previousSnapshot: ReturnType<typeof controller.getSnapshot> | undefined
  let projectedSnapshot: View | undefined
  controller = createHistoryWindow<Header, DisplayBody, Evidence["items"][number]>({
    residencyBudget, refreshDelayMs: 100,
    source: {
      async readPage(id, query, signal) {
        const page = await input.read("history-display", {...identity(id), query}, signal) as Page
        return {...page, conversationId: page?.chatId, bodies: (page?.bodies ?? []).map(body => ({...body,
          conversationId: body.chatId, entry: projectedBody(body)}))}
      },
      async readBody(id, entryId, signal) {
        const header = controller.getSnapshot().rows.find(row => row.header.id === entryId)?.header
        if (!header) throw new Error("Заголовок больше не доступен")
        return await readBody(id, header, signal)
      },
      async readEvidence(id, entryId, query, signal) {
        const page = await input.read("history-evidence", {...identity(id), id: entryId, query}, signal) as Evidence
        return {...page, conversationId: page?.chatId}
      },
    },
    isOrdinary: header => header.kind === "message" && header.role !== "thought" && header.purpose !== "command",
    validateHeader, validateBody, changed: input.changed,
  })
  return {
    ...controller,
    createGroupHistory(group: HistoryGroup): HistoryController<HistoryOccurrence, DisplayBody, unknown> {
      if (selected === null) throw new Error("Беседа не выбрана")
      const chatId = selected.id
      const scope = `${selected.executorId}:${group.id}`
      let released = false
      let notificationQueued = false
      const listeners = new Set<() => void>()
      const changed = () => {
        if (released || notificationQueued) return
        notificationQueued = true
        // Layout/commit вложенного окна не входит повторно во внешний render.
        queueMicrotask(() => {
          notificationQueued = false
          if (!released) for (const listener of listeners) listener()
        })
      }
      let nested: HistoryController<HistoryOccurrence, DisplayBody, unknown>
      nested = createHistoryWindow<HistoryOccurrence, DisplayBody, unknown>({
        // Соседняя страница сохраняет anchor при prepend/eviction в обе стороны.
        pageSize: 16, maxPages: 2, residencyBudget, refreshDelayMs: 100,
        source: {
          async readPage(id, query, signal) {
            const windowQuery = query.before === undefined && query.after === undefined && query.around === undefined ? {...query, before: Number.MAX_SAFE_INTEGER} : query
            const page = await input.read("history-group", {...identity(id), groupId: group.id, query: windowQuery}, signal) as GroupPage
            return {...page, conversationId: page.chatId}
          },
          async readBody(id, occurrenceId, signal) {
            const header = nested.getSnapshot().rows.find(row => row.header.id === occurrenceId)?.header
            if (!header) throw new Error("Событие больше не доступно")
            return await readBody(id, header, signal, group.id)
          },
          async readEvidence(id, occurrenceId) {
            return {conversationId: id, id: occurrenceId, revision: 0, total: 0, start: 0, items: [], before: null, after: null}
          },
        },
        isOrdinary: () => false,
        validateHeader, validateBody, changed,
      })
      const owned = {...nested,
        subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener)}},
        accept(value: Parameters<typeof nested.accept>[0]) {
          if (released) return
          groups.add(owned)
          nested.accept({...value, id: chatId, scope})
        },
        dispose() {released = true; listeners.clear(); nested.dispose(); groups.delete(owned)},
      }
      // Конструктор вызывается из useMemo: accept принадлежит commit effect потребителя.
      return owned
    },
    accept(snapshot: Snapshot) {
      if (selected?.id !== snapshot.id || selected.executorId !== snapshot.executorId) {
        for (const group of groups) group.dispose()
        groups.clear()
      }
      selected = snapshot
      controller.accept({id: snapshot.id, scope: snapshot.executorId, history: snapshot.displayHistory ?? snapshot.history})
    },
    getSnapshot(): View {
      const current = controller.getSnapshot()
      if (current === previousSnapshot && projectedSnapshot !== undefined) return projectedSnapshot
      previousSnapshot = current
      const {conversationId, rows, ...value} = current
      return projectedSnapshot = {...value, chatId: conversationId, rows: rows.map(row => {
        const {evidence, ...entry} = row
        const body = row.body
        const fragments = body && "continuation" in body ? {continuation: body.continuation, ...(body.sourceBytes === undefined ? {} : {sourceBytes: body.sourceBytes})} : {}
        if (evidence === undefined) return {...entry, ...fragments}
        const {conversationId: evidenceConversation, ...details} = evidence
        return {...entry, ...fragments, evidence: {...details, chatId: evidenceConversation}}
      })}
    },
    dispose() {for (const group of groups) group.dispose(); groups.clear(); controller.dispose(); selected = null},
  }
}
