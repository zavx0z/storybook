import {expect, test} from "bun:test"
import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"
import {createChatHistoryWindow} from "../src/inspector/chat-history"

type Snapshot = Awaited<ReturnType<StorybookChatSession.Output["read"]>>
type Entry = Awaited<ReturnType<StorybookChatSession.Output["historyItem"]>>["entry"]
const tick = () => Bun.sleep(0)
function fixture(count = 192, textBytes = 32) {
  let snapshot: Snapshot = {id: "chat", sessionId: "chat", sessionLabel: "Сессия", executorId: "agent", executorLabel: "Агент", address: "/", label: "Project", history: {revision: 1, total: count, lastSequence: count}, pending: [], status: "idle", error: null, permissions: [], version: 0}
  const content = "a".repeat(textBytes)
  const items: Entry[] = Array.from({length: count}, (_, index) => ({id: `m${index}`, sequence: index + 1, origin: "live", kind: "message", role: "assistant", content: [{type: "text", text: content}]}))
  const calls: {operation: string, body: Record<string, unknown>, signal: AbortSignal}[] = []
  const gates = new Map<string, ReturnType<typeof Promise.withResolvers<unknown>>>()
  let hold = false
  const window = createChatHistoryWindow({changed() {}, async read(operation, body, signal) {
    calls.push({operation, body, signal})
    if (body.chatId !== snapshot.id) throw new Error("identity conflict")
    if (operation === "history") {
      const query = body.query as {before?: number, after?: number, around?: number, limit: number}
      const start = query.before !== undefined ? Math.max(0, query.before - query.limit) : query.after !== undefined ? query.after : query.around !== undefined ? Math.max(0, query.around - Math.floor(query.limit / 2)) : Math.max(0, count - query.limit)
      return {chatId: snapshot.id, revision: snapshot.history.revision, total: count, start,
        items: items.slice(start, start + query.limit).map((entry, offset) => ({id: entry.id, kind: entry.kind, origin: entry.origin, role: entry.kind === "message" ? entry.role : undefined,
          sequence: entry.sequence, ordinal: start + offset, revision: 1, bodyBytes: new TextEncoder().encode(JSON.stringify(entry)).byteLength, evidenceCount: entry.kind === "tool" ? 2 : 0})),
        before: start > 0 ? start : null, after: start + query.limit < count ? start + query.limit : null}
    }
    const entry = items.find(item => item.id === body.id)!
    const result = {chatId: snapshot.id, revision: 1, id: entry.id, bytes: new TextEncoder().encode(JSON.stringify(entry)).byteLength, entry, evidenceCount: 0}
    if (hold) {const gate = Promise.withResolvers<unknown>(); gates.set(entry.id, gate); return gate.promise}
    return result
  }})
  return {window, calls, items, gates, snapshot: () => snapshot, hold() {hold = true}, accept(value: Partial<Snapshot> = {}) {snapshot = {...snapshot, ...value}; window.accept(snapshot)}, viewport(ids: string[], direction: "before" | "after" | "none" = "none", following = false) {window.viewport({ids, nearStart: direction === "before", nearEnd: direction === "after", following})}}
}

test("глубокая история держит не более трёх смежных страниц, только visible bodies; eviction требует нового чтения", async () => {
  const f = fixture()
  f.accept()
  await tick()
  expect(f.window.getSnapshot().rows).toHaveLength(32)
  expect(f.calls.filter(call => call.operation === "history-item")).toHaveLength(0)
  f.viewport(["m160"])
  await tick()
  expect(f.window.getSnapshot().rows.find(row => row.header.id === "m160")!.body).toBeDefined()
  f.viewport(["m160"], "before")
  await tick()
  f.viewport(["m128"], "before")
  await tick()
  f.viewport(["m96"], "before")
  await tick()
  expect(f.window.getSnapshot().rows).toHaveLength(96)
  expect(f.window.getSnapshot().rows.at(-1)!.header.ordinal).toBe(159)
  expect(f.window.getSnapshot().rows.some(row => row.header.id === "m160")).toBe(false)
  f.viewport(["m128"], "after")
  await tick()
  f.viewport(["m160"])
  await tick()
  expect(f.calls.filter(call => call.operation === "history-item" && call.body.id === "m160")).toHaveLength(2)
  for (const call of f.calls.filter(call => call.operation === "history")) expect(call.body.query).toMatchObject({limit: 32, maxBytes: 65536})
  f.window.dispose()
})

test("reading past обновляет только summary/unread без загрузки tail; hidden освобождает данные без model cancel", async () => {
  const f = fixture()
  f.accept()
  await tick()
  f.viewport(["m160"], "before")
  await tick()
  const rows = f.window.getSnapshot().rows.map(row => row.header.id)
  const reads = f.calls.length
  f.accept({history: {revision: 2, total: 193, lastSequence: 193}, version: 1})
  expect(f.window.getSnapshot().rows.map(row => row.header.id)).toEqual(rows)
  expect(f.window.getSnapshot().unread).toBe(1)
  expect(f.calls).toHaveLength(reads)
  f.window.setActive(false)
  expect(f.window.getSnapshot().rows).toEqual([])
  expect(f.calls.some(call => call.operation === "cancel")).toBe(false)
  f.window.setActive(true)
  await tick()
  expect(f.window.getSnapshot().rows).toHaveLength(32)
  expect(f.calls.at(-1)!.body.query).toMatchObject({around: 160})
  expect(f.window.getSnapshot().following).toBe(false)
  f.window.dispose()
})

test("не более четырёх body requests, offscreen/dispose отменяют и поздний ответ не восстанавливает данные", async () => {
  const f = fixture(32)
  f.hold()
  f.accept()
  await tick()
  f.viewport(Array.from({length: 10}, (_, index) => `m${index}`))
  expect(f.calls.filter(call => call.operation === "history-item")).toHaveLength(4)
  f.viewport([])
  expect(f.calls.filter(call => call.operation === "history-item").every(call => call.signal.aborted)).toBe(true)
  for (const gate of f.gates.values()) gate.resolve({})
  await tick()
  expect(f.window.getSnapshot().rows.every(row => row.body === undefined)).toBe(true)
  f.window.dispose()
  expect(f.window.getSnapshot().rows).toEqual([])
})

test("same address новый chatId/executor отменяет прежние detail results", async () => {
  const f = fixture(32)
  f.hold()
  f.accept()
  await tick()
  f.viewport(["m0"])
  f.accept({id: "new-chat", sessionId: "new-chat", executorId: "new-agent"})
  const request = f.calls.find(call => call.operation === "history-item")!
  expect(request.signal.aborted).toBe(true)
  f.gates.get("m0")!.resolve({})
  await tick()
  expect(f.window.getSnapshot().chatId).toBe("new-chat")
  expect(f.window.getSnapshot().rows.every(row => row.body === undefined)).toBe(true)
  f.window.dispose()
})

test("byte cache ограничен4MiB; одновременно resident только одно oversize тело <=16MiB", async () => {
  const f = fixture(8, 2 * 1024 * 1024)
  f.accept()
  await tick()
  f.viewport(["m0", "m1", "m2", "m3"])
  await tick()
  const resident = f.window.getSnapshot().rows.filter(row => row.body !== undefined)
  expect(resident.reduce((sum, row) => sum + row.header.bodyBytes, 0)).toBeLessThanOrEqual(4 * 1024 * 1024)
  f.window.dispose()
  const large = fixture(4, 5 * 1024 * 1024)
  large.accept()
  await tick()
  large.viewport(["m0", "m1"])
  await tick()
  expect(large.window.getSnapshot().rows.filter(row => row.body !== undefined)).toHaveLength(1)
  const reads = large.calls.length
  await tick()
  expect(large.calls).toHaveLength(reads)
  large.window.dispose()
})

test("свёрнутое service тело не читается; collapse освобождает details, повторное раскрытие перечитывает", async () => {
  const f = fixture(1)
  f.items[0] = {id: "m0", kind: "context", origin: "local", sequence: 1, content: [{type: "text", text: "Контекст"}]}
  f.accept()
  await tick()
  f.viewport(["m0"])
  expect(f.calls.filter(call => call.operation === "history-item")).toHaveLength(0)
  f.window.expand("m0", true)
  await tick()
  expect(f.window.getSnapshot().rows[0]!.body).toBeDefined()
  f.window.expand("m0", false)
  expect(f.window.getSnapshot().rows[0]!.body).toBeUndefined()
  f.window.expand("m0", true)
  await tick()
  expect(f.calls.filter(call => call.operation === "history-item")).toHaveLength(2)
  f.window.dispose()
})
