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
    if (operation === "history-display") {
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
  for (const call of f.calls.filter(call => call.operation === "history-display")) expect(call.body.query).toMatchObject({limit: 32, maxBytes: 65536})
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

test("группа не читает raw body; первая страница содержит 16 событий и отменяет поздний payload", async () => {
  const group = {id: "service:user:u", kind: "group" as const, origin: "local" as const, ordinal: 2, sequence: 2,
    revision: 1, bodyBytes: 0 as const, evidenceCount: 1000, memberCount: 1000, userId: "u", lastSequence: 1001, title: "Действия"}
  const calls: {operation: string; body: Record<string, unknown>; signal: AbortSignal}[] = []
  const gate = Promise.withResolvers<unknown>()
  const window = createChatHistoryWindow({changed() {}, async read(operation, body, signal) {
    calls.push({operation, body, signal})
    if (operation === "history-display") return {chatId: "chat", revision: 1, total: 1, rawTotal: 1000, projectionRevision: 1,
      start: 2, items: [group], before: null, after: null}
    if (operation === "history-group") {
      expect(body.query).toMatchObject({limit: 16})
      return {chatId: "chat", groupId: group.id, revision: 1, total: 1000, start: 2, before: null, after: 17,
        items: Array.from({length: 16}, (_, i) => ({id: `o${i}`, entryId: `t${i}`, groupId: group.id,
          kind: "tool", origin: "live", ordinal: i + 2, sequence: i + 2, revision: 1, bodyBytes: 100, evidenceCount: 0}))}
    }
    if (operation === "history-group-item") return gate.promise
    throw new Error(`Неожиданный ${operation}`)
  }})
  const snapshot = {id: "chat", executorId: "agent", history: {revision: 1, total: 1000, lastSequence: 1001}, displayHistory: {revision: 1, total: 1, lastSequence: 1001}} as Snapshot
  window.accept(snapshot)
  await tick()
  window.viewport({ids: [group.id], nearStart: false, nearEnd: false, following: true})
  window.expand(group.id, true)
  await tick()
  expect(window.getSnapshot().rows[0]!.body).toEqual({kind: "group", id: group.id})
  expect(calls.some(call => call.operation === "history-item")).toBeFalse()
  const nested = window.createGroupHistory(group)
  nested.accept({id: "chat", history: {revision: group.revision, total: group.memberCount}})
  await tick()
  expect(nested.getSnapshot().rows).toHaveLength(16)
  nested.viewport({ids: ["o0"], nearStart: false, nearEnd: false, following: false})
  expect(calls.some(call => call.operation === "history-group-item")).toBeFalse()
  nested.expand("o0", true)
  await tick()
  const request = calls.find(call => call.operation === "history-group-item")!
  expect(request.body).toMatchObject({groupId: group.id, id: "o0"})
  nested.dispose()
  expect(request.signal.aborted).toBeTrue()
  gate.resolve({})
  await tick()
  expect(nested.getSnapshot().rows).toHaveLength(0)
  window.dispose()
})

test("первая неудачная display page повторяется явным retryPage", async () => {
  let attempts = 0
  const window = createChatHistoryWindow({changed() {}, async read(operation) {
    expect(operation).toBe("history-display")
    if (++attempts === 1) throw new Error("Временная ошибка сети")
    return {chatId: "chat", revision: 1, total: 0, start: 0, items: [], before: null, after: null}
  }})
  window.accept({id: "chat", executorId: "agent", history: {revision: 1, total: 1, lastSequence: 1}} as Snapshot)
  await tick()
  expect(window.getSnapshot().error).toBe("Временная ошибка сети")
  window.retryPage()
  await tick()
  expect(attempts).toBe(2)
  expect(window.getSnapshot().error).toBeUndefined()
  window.dispose()
})

test("создание nested controller не публикует snapshot и не начинает чтение до commit effect", async () => {
  let notifications = 0
  let groupReads = 0
  const window = createChatHistoryWindow({changed() {notifications++}, async read(operation) {
    if (operation === "history-group") groupReads++
    return {chatId: "chat", revision: 1, total: 0, start: 0, items: [], before: null, after: null}
  }})
  window.accept({id: "chat", executorId: "agent", history: {revision: 1, total: 1, lastSequence: 1}} as Snapshot)
  await tick()
  const before = notifications
  const group = {id: "service:user:u", kind: "group" as const, origin: "local" as const, ordinal: 2, sequence: 2, revision: 1,
    bodyBytes: 0 as const, evidenceCount: 1000, memberCount: 1000, userId: "u", lastSequence: 1001, title: "Действия"}
  const nested = window.createGroupHistory(group)
  try {
    expect(notifications - before).toBe(0)
    expect(groupReads).toBe(0)
    nested.accept({id: "chat", history: {revision: 1, total: 1000}})
    await tick()
    expect(groupReads).toBe(1)
  } finally {nested.dispose(); window.dispose()}
})

test("factory группы удерживает две страницы по16 и освобождает дальнюю при смене направления", async () => {
  const total = 108
  const group = {id: "service:user:u", kind: "group" as const, origin: "local" as const, ordinal: 1, sequence: 1, revision: 1,
    bodyBytes: 0 as const, evidenceCount: total, memberCount: total, userId: "u", lastSequence: total, title: "Действия"}
  let groupReads = 0
  let bodyReads = 0
  const window = createChatHistoryWindow({changed() {}, async read(operation, body) {
    if (operation === "history-display") return {chatId: "chat", revision: 1, total: 1, rawTotal: total, projectionRevision: 1, start: 1, items: [{...group}], before: null, after: null}
    if (operation === "history-group") {
      groupReads++
      const query = body.query as {before?: number; after?: number; limit: number}
      expect(query.limit).toBe(16)
      const start = query.before !== undefined ? Math.max(0, Math.min(total, query.before) - query.limit) : query.after !== undefined ? query.after + 1 : total - query.limit
      return {chatId: "chat", groupId: group.id, revision: 1, total, start, before: start > 0 ? start : null, after: start + 16 < total ? start + 15 : null,
        items: Array.from({length: Math.min(16, total - start)}, (_, offset) => ({id: `o${start + offset}`, entryId: `t${start + offset}`, groupId: group.id,
          kind: "tool", origin: "live", ordinal: start + offset, sequence: start + offset + 1, revision: 1, bodyBytes: 100, evidenceCount: 0}))}
    }
    bodyReads++
    throw new Error("Свёрнутые события не должны читать body")
  }})
  window.accept({id: "chat", executorId: "agent", history: {revision: 1, total, lastSequence: total}, displayHistory: {revision: 1, total: 1, lastSequence: total}} as Snapshot)
  const nested = window.createGroupHistory(group)
  try {
    nested.accept({id: "chat", history: {revision: 1, total}})
    await tick()
    expect(nested.getSnapshot().rows.map(row => row.header.ordinal)).toEqual(Array.from({length: 16}, (_, i) => 92 + i))
    nested.viewport({ids: ["o92"], nearStart: true, nearEnd: false, following: false})
    await tick()
    expect(nested.getSnapshot().rows.map(row => row.header.ordinal)).toEqual(Array.from({length: 32}, (_, i) => 76 + i))
    nested.viewport({ids: ["o76"], nearStart: true, nearEnd: false, following: false})
    await tick()
    expect(nested.getSnapshot().rows.map(row => row.header.ordinal)).toEqual(Array.from({length: 32}, (_, i) => 60 + i))
    nested.viewport({ids: ["o91"], nearStart: false, nearEnd: true, following: false})
    await tick()
    expect(nested.getSnapshot().rows.map(row => row.header.ordinal)).toEqual(Array.from({length: 32}, (_, i) => 76 + i))
    expect(groupReads).toBe(4)
    expect(bodyReads).toBe(0)
  } finally {nested.dispose(); window.dispose()}
})
