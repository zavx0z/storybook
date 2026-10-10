import {expect, test} from "bun:test"
import {Event, createDocument, type HTMLElement} from "@zavx0z/immersive"
import {createRoot} from "@zavx0z/immersive/XReact"
import {createDocumentRenderer, createDocumentInteractionController} from "@zavx0z/immersive/renderer/html"
import {flushDocumentLayoutObservers} from "@zavx0z/immersive"
import type {CompiledTemplate} from "@zavx0z/immersive/XReact/compiled"
import type {StorybookChatSession, HistoryGroup} from "@zavx0z/storybook-chat-session"
import type {StorybookChatView} from "../contract"
import {createChatHistoryWindow} from "../../../app/web/page/shell/workbench/src/inspector/chat-history"
import GroupIntegration, {type GroupIntegrationProps} from "./fixture/group-integration"

type Message = Extract<HistoryBody["entry"], {kind: "message"}>
type Session = StorybookChatSession.Output
type HistoryBody = Awaited<ReturnType<Session["historyItem"]>>
type HistoryDisplayPage = Awaited<ReturnType<Session["displayHistory"]>>
type HistoryQuery = NonNullable<Parameters<Session["displayHistory"]>[1]>

/** Настоящий ChatView и внешний store; источник имитирует подтверждённые HTTP-страницы. */
async function fixture(count: number, withGroup = false, unresolved = false) {
  const document = createDocument()
  const host = document.createElement("div")
  document.append(host)
  const root = createRoot(host)
  const theme = await Bun.file(new URL(import.meta.resolve("@zavx0z/immersive/ui/theme.css"))).text()
  const renderer = createDocumentRenderer({document, root: host, viewport: {width: 480, height: 700}, styleSheets: [theme]})
  const input = createDocumentInteractionController({document})
  let revision = 1
  const message = (index: number): Message => ({id: `m${index}`, sequence: index + 1 + Number(withGroup),
    kind: "message", origin: unresolved && index === 0 ? "replay" : "local", role: index % 2 === 0 ? "user" : "assistant",
    ...(unresolved && index === 0 ? {authorship: "unresolved" as const, providerMessageId: "native-unresolved"} : {}),
    content: [{type: "text", text: (index % 2 === 0 ? "Обычное сообщение пользователя. " : "Короткий ответ ассистента. ").repeat(5)}]})
  const messages: Message[] = Array.from({length: count}, (_, index) => message(index))
  const group: HistoryGroup = {id: "service:prelude", kind: "group", origin: "local", ordinal: 0, sequence: 1,
    revision: 1, bodyBytes: 0, evidenceCount: 8, memberCount: 8, userId: null, lastSequence: 1, title: "Действия агента"}
  const calls: {operation: string, query?: HistoryQuery}[] = []
  const listeners = new Set<() => void>()
  let renders = 0
  let notifications = 0
  let creations = 0
  let disposals = 0
  let view: StorybookChatView.Input
  let nested: ReturnType<ReturnType<typeof createChatHistoryWindow>["createGroupHistory"]> | undefined
  const history = createChatHistoryWindow({
    changed() {
      if (++notifications > 500) throw new Error("История не стабилизировалась")
      view = {...view, history: history.getSnapshot()}
      for (const listener of listeners) listener()
    },
    async read(operation, body) {
      const query = body.query as HistoryQuery | undefined
      calls.push({operation, ...(query === undefined ? {} : {query})})
      if (operation === "history-display") {
        const all = messages.map(entry => ({id: entry.id, ordinal: entry.sequence - 1, sequence: entry.sequence,
          revision: 1, kind: entry.kind, origin: entry.origin, role: entry.role,
          bodyBytes: Buffer.byteLength(JSON.stringify(entry)), evidenceCount: 0}))
        const items: HistoryDisplayPage["items"] = withGroup ? [group, ...all] : all
        const limit = query?.limit ?? 32
        let start: number
        if (query?.before !== undefined) start = Math.max(0, query.before - limit)
        else if (query?.after !== undefined) start = query.after + 1
        else if (query?.around !== undefined) start = Math.max(0, query.around - Math.floor(limit / 2))
        else start = Math.max(0, items.length - limit)
        const headers = items.slice(start, start + limit)
        const bodies: HistoryBody[] = headers.flatMap(header => {
          const entry = messages.find(value => value.id === header.id)
          return entry ? [{chatId: "chat", id: entry.id, revision: header.revision,
            bytes: header.bodyBytes, entry: structuredClone(entry), evidenceCount: 0}] : []
        })
        return {chatId: "chat", revision, total: items.length, rawTotal: items.length, projectionRevision: 1,
          start, items: structuredClone(headers), bodies,
          before: start === 0 ? null : start, after: start + headers.length < items.length ? start + headers.length - 1 : null} satisfies HistoryDisplayPage
      }
      if (operation === "history-group") return {chatId: "chat", groupId: group.id, revision: 1, total: 8,
        start: 0, before: null, after: null,
        items: Array.from({length: 8}, (_, index) => ({id: `event:${index}`, entryId: `event:${index}`, groupId: group.id,
          kind: "event", origin: "live", eventType: "usage_update", ordinal: index, sequence: index + 1,
          revision: 1, bodyBytes: 100, evidenceCount: 0}))}
      throw new Error(`Неожиданное чтение ${operation}: короткие сообщения уже входят в страницу`)
    },
  })
  view = {address: "/retained-history", label: "Короткая беседа", status: "idle", draft: "", history: history.getSnapshot(),
    createGroupHistory(value) {
      creations++
      const created = history.createGroupHistory(value)
      nested = {...created, dispose() {disposals++; created.dispose()}}
      return nested
    },
    onDraftChange() {}, onSend() {}, onCancel() {},
    onHistoryViewport: history.viewport, onHistoryVisible: history.setActive, onHistoryExpand: history.expand,
    onHistoryRetry: history.retry, onHistoryEvidence: history.evidence, onHistoryTail: history.tail,
  }
  const store = {
    getSnapshot: () => view,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener)}},
    rendered() {if (++renders > 500) throw new Error("Представление не стабилизировалось")},
  }
  const log = () => host.querySelector('[role="log"]') as HTMLElement
  const rows = () => [...log().querySelectorAll("[data-chat-history-id]")] as HTMLElement[]
  const articles = () => [...log().querySelectorAll("article[data-conversation-message]")]
  const settle = async () => {
    for (let turn = 0; turn < 8; turn++) {
      root.flush()
      renderer.flush()
      flushDocumentLayoutObservers(document)
      await Bun.sleep(0)
    }
  }
  const wheel = (deltaY: number) => {
    const frame = renderer.flush()
    const rect = log().getLayoutRect()!
    return input.wheel(frame, {clientX: rect.right - 4, clientY: rect.top + Math.min(40, rect.height / 2), deltaX: 0, deltaY})
  }
  const accept = () => history.accept({id: "chat", executorId: "agent",
    history: {revision, total: messages.length + Number(withGroup), lastSequence: messages.at(-1)!.sequence},
    displayHistory: {revision, total: messages.length + Number(withGroup), lastSequence: messages.at(-1)!.sequence}} as Parameters<typeof history.accept>[0])
  const anchor = () => {
    const rect = log().getLayoutRect()!
    const visible = rows().map(row => ({row, rect: row.getLayoutRect(log())!})).filter(value => value.rect.bottom > 0 && value.rect.top < rect.height)
    const first = visible.find(value => value.rect.top >= 0) ?? visible[0]!
    return {id: first.row.getAttribute("data-chat-history-id")!, top: first.rect.top}
  }
  accept()
  await Bun.sleep(0)
  root.render(GroupIntegration as unknown as CompiledTemplate<GroupIntegrationProps>, {store})
  await settle()
  return {document, host, history, calls, settle, log, rows, articles, wheel, anchor,
    group, getNested: () => nested, counters: () => ({renders, notifications, creations, disposals}),
    append() {
      messages.push({...message(messages.length), role: "assistant",
        content: [{type: "text", text: "Новый потоковый ответ ассистента. ".repeat(5)}]})
      revision++
      accept()
    },
    dispose() {input.dispose(); history.dispose(); root.unmount(); renderer.dispose()},
  }
}

test("12 коротких сообщений сохраняют article identity без body IO и childList за 20 wheel round trips", async () => {
  const f = await fixture(12)
  let unsubscribe = () => {}
  try {
    const initial = f.articles()
    expect(initial).toHaveLength(12)
    expect(f.host.querySelectorAll("[data-chat-body-placeholder]")).toHaveLength(0)
    const tail = f.log().scrollTop
    expect(tail).toBeGreaterThan(240)
    const initialCalls = f.calls.length
    let childChanges = 0
    unsubscribe = f.document.subscribeMutations(batch => {
      childChanges += batch.records.filter(record => record.type === "childList" && f.log().contains(record.target)).length
    })
    for (let cycle = 0; cycle < 20; cycle++) {
      expect(f.wheel(-240)).not.toBeNull()
      await f.settle()
      expect(f.log().scrollTop).toBeLessThan(tail - 200)
      expect(f.host.querySelectorAll("[data-chat-body-placeholder]")).toHaveLength(0)
      expect(f.articles()).toHaveLength(12)
      for (const [index, article] of f.articles().entries()) expect(article).toBe(initial[index]!)
      expect(f.wheel(240)).not.toBeNull()
      await f.settle()
      expect(Math.abs(f.log().scrollTop - tail)).toBeLessThanOrEqual(1)
    }
    expect(f.calls).toHaveLength(initialCalls)
    expect(f.calls.filter(call => call.operation !== "history-display")).toEqual([])
    expect(childChanges, "Обычный scroll не перестраивает уже загруженные сообщения").toBe(0)
    expect(f.host.querySelectorAll("[data-chat-body-placeholder]")).toHaveLength(0)
  } finally {unsubscribe(); f.dispose()}
}, 30_000)

test("новый ответ при чтении прошлого сохраняет resident страницы, article и anchor; unread обновляется", async () => {
  const f = await fixture(96)
  try {
    expect(f.wheel(-10000)).not.toBeNull()
    await f.settle()
    expect(f.wheel(-240)).not.toBeNull()
    await f.settle()
    expect(f.history.getSnapshot().following).toBeFalse()
    const beforeRows = f.history.getSnapshot().rows.map(row => row.header.id)
    const beforeArticles = new Map(f.articles().map(article => [article.getAttribute("data-conversation-message"), article]))
    const before = f.anchor()
    const scrollTop = f.log().scrollTop
    f.append()
    await Bun.sleep(120)
    await f.settle()
    expect(f.history.getSnapshot().following).toBeFalse()
    expect(f.history.getSnapshot().unread).toBeGreaterThan(0)
    for (const id of beforeRows) expect(f.history.getSnapshot().rows.some(row => row.header.id === id)).toBeTrue()
    for (const article of f.articles()) {
      const previous = beforeArticles.get(article.getAttribute("data-conversation-message"))
      if (previous) expect(article).toBe(previous)
    }
    const row = f.rows().find(value => value.getAttribute("data-chat-history-id") === before.id)!
    expect(row).toBeDefined()
    expect(Math.abs(row.getLayoutRect(f.log())!.top - before.top)).toBeLessThanOrEqual(1)
    expect(Math.abs(f.log().scrollTop - scrollTop)).toBeLessThanOrEqual(1)
    expect(f.host.querySelectorAll("[data-chat-body-placeholder]")).toHaveLength(0)
    expect(f.calls.filter(call => call.operation !== "history-display")).toEqual([])
  } finally {f.dispose()}
}, 30_000)

test("раскрытая группа сохраняет controller и содержимое после ухода за экран при outer wheel", async () => {
  const f = await fixture(12, true)
  try {
    expect(f.wheel(-10000)).not.toBeNull()
    await f.settle()
    const button = f.host.querySelector('[data-chat-kind="group"] [aria-expanded="false"]')!
    expect(button).not.toBeNull()
    button.dispatchEvent(new Event("pointerdown", {bubbles: true}))
    button.dispatchEvent(new Event("click", {bubbles: true}))
    await f.settle()
    const controller = f.getNested()
    const content = f.host.querySelector("[data-chat-service-group]")!
    expect(content).not.toBeNull()
    expect(controller!.getSnapshot().rows).toHaveLength(8)
    const reads = f.calls.filter(call => call.operation === "history-group").length
    expect(f.wheel(10000)).not.toBeNull()
    await f.settle()
    expect(f.host.querySelector('[data-chat-history-id="service:prelude"]')!.getLayoutRect(f.log())!.bottom).toBeLessThan(0)
    expect(f.getNested()).toBe(controller)
    expect(f.host.querySelector("[data-chat-service-group]")).toBe(content)
    expect(f.counters()).toMatchObject({creations: 1, disposals: 0})
    expect(f.wheel(-10000)).not.toBeNull()
    await f.settle()
    expect(f.getNested()).toBe(controller)
    expect(f.host.querySelector("[data-chat-service-group]")).toBe(content)
    expect(f.host.querySelector('[data-chat-kind="group"] [aria-expanded="true"]')).not.toBeNull()
    expect(f.calls.filter(call => call.operation === "history-group")).toHaveLength(reads)
  } finally {f.dispose()}
}, 30_000)


test("неустановленный replay автор показан нейтрально, без своей плашки и выдуманного времени", async () => {
  const f = await fixture(2, false, true)
  try {
    expect(f.history.getSnapshot().error).toBeUndefined()
    expect(f.articles()).toHaveLength(2)
    const article = f.articles()[0]!
    expect(article.getAttribute("data-message-own")).toBe("false")
    expect(article.getAttribute("aria-label")).toBe("Сообщение из истории исполнителя")
    expect(article.querySelector("time")).toBeNull()
    expect(article.textContent).toContain("Обычное сообщение пользователя")
  } finally {f.dispose()}
}, 30_000)
