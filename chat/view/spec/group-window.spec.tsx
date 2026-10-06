import {expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import {createHistoryWindow, type HistoryController} from "@zavx0z/chat/history"
import type {HistoryOccurrence} from "@zavx0z/storybook-chat-session"
import type {StorybookChatView} from "../contract"
import type {DisplayBody} from "../contract/history"
import {ChatTimeline} from "../src/timeline"

test("одна группа между ответами; collapse освобождает вложенное окно и отзывает payload", async () => {
  const headless = createHeadless({width: 480, height: 700})
  let nested: HistoryController<HistoryOccurrence, DisplayBody, unknown> | undefined
  let request: AbortSignal | undefined
  let closed = 0
  const gate = Promise.withResolvers<never>()
  const group = {id: "service:user:u", kind: "group" as const, origin: "local" as const, ordinal: 2, sequence: 2, revision: 1,
    bodyBytes: 0 as const, evidenceCount: 1000, memberCount: 1000, userId: "u", lastSequence: 1001, title: "Действия"}
  const assistant = (id: string, sequence: number): StorybookChatView.Input["history"]["rows"][number] => ({
    header: {id, kind: "message", role: "assistant", origin: "live", ordinal: sequence, sequence, revision: 1, bodyBytes: 20, evidenceCount: 0},
    body: {id, kind: "message", role: "assistant", origin: "live", sequence, content: [{type: "text", text: id}]}, expanded: false, loading: false,
  })
  let expanded = true
  const factory: NonNullable<StorybookChatView.Input["createGroupHistory"]> = () => {
    const controller = createHistoryWindow<HistoryOccurrence, DisplayBody, unknown>({
      pageSize: 16, maxPages: 1, changed() {}, isOrdinary: () => false,
      source: {
        async readPage(conversationId) {
          return {conversationId, revision: 1, total: 1000, start: 2, before: null, after: 17,
            items: Array.from({length: 16}, (_, i) => ({id: `event:${i}`, entryId: `event:${i}`, groupId: group.id,
              kind: "event" as const, origin: "live" as const, eventType: "usage_update", ordinal: i + 2, sequence: i + 2, revision: 1, bodyBytes: 100, evidenceCount: 0}))}
        },
        async readBody(_chat, _id, signal) {request = signal; return gate.promise},
        async readEvidence() {throw new Error("unused")},
      },
    })
    nested = {...controller, dispose() {closed++; controller.dispose()}}
    return nested
  }
  const view = (): StorybookChatView.Input => ({address: "/", label: "Chat", status: "idle", draft: "",
    history: {chatId: "chat", revision: 1, total: 3, before: null, after: null, unread: 0, following: false, loading: false,
      rows: [assistant("before", 1), {header: group, body: expanded ? {kind: "group", id: group.id} : undefined, expanded, loading: false}, assistant("after", 1002)]},
    createGroupHistory: factory, onDraftChange() {}, onSend() {}, onCancel() {}, onHistoryViewport() {}, onHistoryVisible() {},
    onHistoryExpand() {}, onHistoryRetry() {}, onHistoryEvidence() {}, onHistoryTail() {},
  })
  try {
    const element = await headless.render(<ChatTimeline view={view()} />)
    await Bun.sleep(0)
    await headless.render(<ChatTimeline view={view()} />)
    await headless.capture(element)
    expect(element.querySelectorAll("[data-chat-service-group]")).toHaveLength(1)
    expect(element.querySelectorAll("[data-chat-message]")).toHaveLength(2)
    expect(element.querySelectorAll("[data-chat-service-group] [data-chat-history-id]").length).toBeLessThanOrEqual(16)
    expect(nested!.getSnapshot().rows).toHaveLength(16)
    nested!.viewport({ids: ["event:0"], nearStart: false, nearEnd: false, following: false})
    nested!.expand("event:0", true)
    await Bun.sleep(0)
    expect(request).toBeDefined()
    expanded = false
    await headless.render(<ChatTimeline view={view()} />)
    expect(request!.aborted).toBeTrue()
    expect(closed).toBe(1)
    expect(nested!.getSnapshot().rows).toHaveLength(0)
    expect(element.querySelectorAll("[data-chat-service-group]")).toHaveLength(0)
  } finally {await headless.dispose()}
})
