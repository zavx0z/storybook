import {afterEach, expect, test} from "bun:test"
import {Database} from "bun:sqlite"
import {mkdtemp, readFile, rm, stat, writeFile, appendFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {openArchive, readArchiveMetadata, readArchiveState, copyArchive, type ArchiveMetadata, type ArchiveMutation} from "../src/archive"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chat-disk-archive-"))
  cleanup.push(() => rm(root, {recursive: true, force: true}))
  const file = join(root, "meta/chat/chat.json")
  const metadata: ArchiveMetadata = {id: "chat", executorId: "executor", executorLabel: "Исполнитель", address: "/", pending: [], historyComplete: true, status: "idle", error: null}
  const open = async (selected = file, meta = metadata) => {
    const archive = await openArchive(selected, meta)
    cleanup.push(() => archive.dispose())
    return archive
  }
  return {root, file, metadata, open}
}
const message = (id: string, text = id): ArchiveMutation => ({type: "append", item: {id, kind: "message", role: "user", origin: "local", content: [{type: "text", text}]}})

test("пустой handle не создаёт source/cache; commit одновременно сохраняет canonical message и pending", async () => {
  const f = await fixture()
  const archive = await f.open()
  expect(archive.exists).toBeFalse()
  expect(archive.page().items).toEqual([])
  await expect(stat(join(f.root, "meta"))).rejects.toThrow()
  await archive.commit({...f.metadata, pending: ["user:r"]}, [message("user:r", "Задача")])
  expect(archive.metadata.pending).toEqual(["user:r"])
  const header = JSON.parse(await readFile(f.file, "utf8"))
  expect(header).toMatchObject({schemaVersion: 3, metadata: {pending: ["user:r"]}, history: {total: 1, lastSequence: 1}})
  expect(header.timeline).toBeUndefined()
  await archive.dispose()
  const restored = await f.open()
  expect(restored.metadata.pending).toEqual(["user:r"])
  expect(restored.content("user:r")).toEqual([{type: "text", text: "Задача"}])
})

test("10000/100000 дисковых записей оставляют bounded residency и страницы, холодный lookup работает после rebuild", async () => {
  const f = await fixture()
  const archive = await f.open()
  Bun.gc(true)
  const startHeap = process.memoryUsage().heapUsed
  const startedAt = performance.now()
  let sampledHeapMaximum = startHeap
  for (let start = 0; start < 100_000; start += 1000) {
    await archive.commit(undefined, Array.from({length: 1000}, (_, index) => message(`user:${start + index}`)))
    sampledHeapMaximum = Math.max(sampledHeapMaximum, process.memoryUsage().heapUsed)
    if (start === 9000 || start === 99_000) {
      expect(archive.residency().entries).toBe(0)
      expect(archive.page().items).toHaveLength(32)
      expect(Buffer.byteLength(JSON.stringify(archive.page()))).toBeLessThan(64 * 1024)
      expect(archive.residency().maximumQueuedBytes).toBeLessThan(1024 * 1024)
    }
  }
  await archive.flush()
  const writeMs = performance.now() - startedAt
  Bun.gc(true)
  const finalHeap = process.memoryUsage().heapUsed
  expect(finalHeap - startHeap).toBeLessThan(32 * 1024 * 1024)
  expect(archive.stats()).toMatchObject({total: 100_000, lastSequence: 100_000})
  expect(archive.page({around: 0}).items[0]?.id).toBe("user:0")
  expect(archive.page({after: 49999}).items[0]?.id).toBe("user:50000")
  expect(archive.page({before: 100000, limit: 64}).items.at(-1)?.id).toBe("user:99999")
  const header = JSON.parse(await readFile(f.file, "utf8"))
  const journalBytes = (await stat(join(f.root, "meta/chat", header.journal))).size
  const cacheBytes = (await stat(archive.cacheFile)).size
  const pageBytes = Buffer.byteLength(JSON.stringify(archive.page()))
  expect(journalBytes).toBeGreaterThan(10 * 1024 * 1024)
  await archive.dispose()
  await rm(archive.cacheFile)
  const rebuildStart = performance.now()
  const restored = await f.open()
  const rebuildMs = performance.now() - rebuildStart
  expect(restored.lookup("user:0")).toMatchObject({ordinal: 0, sequence: 1})
  expect(restored.content("user:99999")).toEqual([{type: "text", text: "user:99999"}])
  expect(restored.residency().entries).toBe(0)
  if (process.env.CHAT_ARCHIVE_BENCHMARK === "1") console.log(JSON.stringify({records: 100_000, transactions: header.history.revision,
    writeMs, rebuildMs, startHeap, finalHeap, sampledHeapMaximum, journalBytes, cacheBytes, pageBytes, residency: restored.residency()}))
}, 120_000)

test("raw событие записывается один раз; replay обновляет холодную запись и сохраняет evidence identities", async () => {
  const f = await fixture()
  let archive = await f.open()
  const cursor = {}
  await archive.receive({sessionUpdate: "agent_message_chunk", messageId: "stable", content: {type: "text", text: "Прежний ответ"}}, "live", cursor)
  const id = archive.findProvider("assistant", "stable")!.id
  await archive.receive({sessionUpdate: "tool_call", toolCallId: "tool", title: "Чтение", status: "in_progress", rawOutput: {unique: "UNIQUE_RAW_PAYLOAD"}}, "live", cursor)
  const tool = archive.findTool("tool")!
  const header = JSON.parse(await readFile(f.file, "utf8"))
  expect((await readFile(join(f.root, "meta/chat", header.journal), "utf8")).match(/UNIQUE_RAW_PAYLOAD/gu)).toHaveLength(1)
  await archive.dispose()
  await rm(archive.cacheFile)
  archive = await f.open()
  const replay = {}
  await archive.receive({sessionUpdate: "agent_message_chunk", messageId: "stable", content: {type: "text", text: "Новый "}}, "replay", replay)
  await archive.receive({sessionUpdate: "agent_message_chunk", messageId: "stable", content: {type: "text", text: "ответ"}}, "replay", replay)
  expect(archive.findProvider("assistant", "stable")!.id).toBe(id)
  expect(archive.body(id).entry).toMatchObject({content: [{type: "text", text: "Новый ответ"}]})
  expect(archive.evidence(id).items).toHaveLength(3)
  await archive.receive({sessionUpdate: "tool_call_update", toolCallId: "tool", title: null, status: "completed", rawOutput: null}, "replay", replay)
  expect(archive.findTool("tool")!.id).toBe(tool.id)
  expect(archive.body(tool.id).entry).toMatchObject({call: {title: "Чтение", status: "completed", rawOutput: null}, updates: []})
  expect(archive.stats().total).toBe(2)
  const evidence = archive.evidence(id).items
  await archive.dispose()
  await rm(archive.cacheFile)
  archive = await f.open()
  expect(archive.evidence(id).items).toEqual(evidence)
  await archive.receive({sessionUpdate: "agent_message_chunk", messageId: "stable", content: {type: "text", text: "Ещё replay"}}, "replay", {})
  expect(archive.body(id).entry).toMatchObject({content: [{type: "text", text: "Ещё replay"}]})
})

test("страница headers не читает большие tool payload, evidence проверяет byte budget до payload чтения", async () => {
  const f = await fixture()
  const archive = await f.open()
  const payload = "a".repeat(200_000)
  await archive.receive({sessionUpdate: "tool_call", toolCallId: "large", title: "Результат", rawOutput: payload}, "live", {})
  for (let index = 0; index < 4; index++) await archive.receive({sessionUpdate: "tool_call_update", toolCallId: "large", rawOutput: payload}, "live", {})
  const id = archive.findTool("large")!.id
  expect(Buffer.byteLength(JSON.stringify(archive.page()))).toBeLessThan(1024)
  expect(archive.page().items[0]!.bodyBytes).toBeGreaterThan(200_000)
  expect(archive.evidence(id).items).toHaveLength(1)
  expect(archive.evidence(id, {after: 0}).start).toBe(1)
  expect(archive.body(id).evidenceCount).toBe(5)
})

test.each([1, 2])("потоковая миграция schema%d сохраняет original bytes, identities и незавершённый start", async version => {
  const f = await fixture()
  const legacy = version === 1 ? {...f.metadata, schemaVersion: 1, messages: [{id: "user:old", role: "user", text: "Старая история"}]}
    : {...f.metadata, schemaVersion: 2, timeline: [
      {id: "user:old", sequence: 1, origin: "local", kind: "message", role: "user", content: [{type: "text", text: "Старая история"}]},
      {id: "start", sequence: 2, origin: "local", kind: "turn", requestId: "old", state: "started"},
    ]}
  const original = JSON.stringify(legacy, null, 2) + "\n"
  await Bun.write(f.file, original)
  expect((await readArchiveMetadata(f.file))!.id).toBe("chat")
  expect(await readFile(f.file, "utf8")).toBe(original)
  const archive = await f.open()
  expect(await readFile(`${f.file}.schema${version}`, "utf8")).toBe(original)
  expect(archive.body("user:old").entry).toMatchObject({id: "user:old", content: [{type: "text", text: "Старая история"}]})
  expect(archive.metadata.activeRequest).toBe(version === 2 ? "old" : undefined)
  expect(archive.metadata.historyComplete).toBe(version === 2)
})

test("повреждённая миграция не переключает original; неподтверждённый хвост виден и committed truncation отказывает", async () => {
  const f = await fixture()
  const broken = JSON.stringify({...f.metadata, schemaVersion: 2, timeline: [
    {id: "duplicate", sequence: 1, origin: "local", kind: "message", role: "user", content: []},
    {id: "duplicate", sequence: 2, origin: "local", kind: "message", role: "user", content: []},
  ]})
  await Bun.write(f.file, broken)
  await expect(f.open()).rejects.toThrow()
  expect(await readFile(f.file, "utf8")).toBe(broken)
  await rm(f.file)
  let archive = await f.open()
  await archive.commit(undefined, [message("saved")])
  const header = JSON.parse(await readFile(f.file, "utf8"))
  const journal = join(f.root, "meta/chat", header.journal)
  await archive.dispose()
  await appendFile(journal, "unfinished mutation")
  archive = await f.open()
  expect(archive.residency().uncommittedBytes).toBeGreaterThan(0)
  expect(archive.stats().total).toBe(1)
  await archive.commit(undefined, [message("after")])
  expect(archive.residency().uncommittedBytes).toBe(0)
  await archive.dispose()
  const data = await readFile(journal)
  await writeFile(journal, data.subarray(0, data.length - 1))
  await expect(f.open()).rejects.toThrow("обрезан")
})

test("копирование корпуса сохраняет source и identity без загрузки payload; цель не перезаписывается", async () => {
  const f = await fixture()
  const archive = await f.open()
  await archive.commit(undefined, [message("saved")])
  await archive.flush()
  const destination = join(f.root, "new/meta/chat/chat.json")
  const before = await readFile(f.file, "utf8")
  await copyArchive(f.file, destination, {...f.metadata, address: "/new"})
  expect(await readFile(f.file, "utf8")).toBe(before)
  const copied = await f.open(destination, {...f.metadata, address: "/new"})
  expect(copied.content("saved")).toEqual(archive.content("saved"))
  await expect(copyArchive(f.file, destination, {...f.metadata, address: "/new"})).rejects.toThrow()
})

test("ACP media и supplied resource blocks сохраняются без изменения через restart и rebuild", async () => {
  const f = await fixture()
  let archive = await f.open()
  const content = [
    {type: "text" as const, text: "Контекст", _meta: {source: "fixture"}},
    {type: "image" as const, mimeType: "image/png", data: "AA=="},
    {type: "audio" as const, mimeType: "audio/wav", data: "AA=="},
    {type: "resource" as const, resource: {uri: "context://subject", mimeType: "text/plain", text: "Предоставленный контекст"}},
    {type: "resource_link" as const, uri: "file:///fixture.txt", name: "fixture.txt", mimeType: "text/plain"},
  ]
  await archive.commit(undefined, [{type: "append", item: {id: "media", kind: "message", role: "user", origin: "local", content}}])
  expect(archive.content("media")).toEqual(content)
  await archive.dispose()
  await rm(archive.cacheFile)
  archive = await f.open()
  expect(archive.content("media")).toEqual(content)
  expect(archive.body("media").entry).toMatchObject({content})
})

test("body и одиночный raw event больше 16 MiB остаются в source и дают явную ошибку чтения", async () => {
  const f = await fixture()
  const archive = await f.open()
  await archive.receive({sessionUpdate: "tool_call", toolCallId: "oversized", title: "Большой результат", rawOutput: "a".repeat(17 * 1024 * 1024)}, "live", {})
  const entry = archive.findTool("oversized")!
  expect(entry.bodyBytes).toBeGreaterThan(16 * 1024 * 1024)
  expect(Buffer.byteLength(JSON.stringify(archive.page()))).toBeLessThan(1024)
  expect(() => archive.body(entry.id)).toThrow("16 MiB")
  expect(() => archive.evidence(entry.id)).toThrow("16 MiB")
  const header = JSON.parse(await readFile(f.file, "utf8"))
  expect((await stat(join(f.root, "meta/chat", header.journal))).size).toBeGreaterThan(17 * 1024 * 1024)
  await archive.dispose()
  const restored = await f.open()
  expect(restored.findTool("oversized")!.id).toBe(entry.id)
  expect(() => restored.body(entry.id)).toThrow("16 MiB")
}, 30_000)

test("два handle одного файла не могут затереть подтверждённую запись stale writer", async () => {
  const f = await fixture()
  const initial = await f.open()
  await initial.commit(undefined, [message("initial")])
  await initial.dispose()
  const first = await f.open()
  const second = await f.open()
  const results = await Promise.allSettled([
    first.commit(undefined, [message("first")]),
    second.commit(undefined, [message("second")]),
  ])
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
  const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult
  expect(String(rejected.reason)).toContain("другим writer")
  expect(first.residency().activeWriteLeases).toBe(0)
  await first.dispose()
  await second.dispose()
  const fresh = await f.open()
  expect(fresh.stats().total).toBe(2)
  expect(fresh.lookup("initial")).not.toBeNull()
  const accepted = results[0]!.status === "fulfilled" ? "first" : "second"
  expect(fresh.lookup(accepted)).not.toBeNull()
  const retry = accepted === "first" ? "second" : "first"
  await fresh.commit(undefined, [message(retry)])
  expect(fresh.stats().total).toBe(3)
  await fresh.commit(undefined, [{type: "remove", id: "missing"}])
  expect(fresh.stats().total).toBe(3)
  await fresh.commit(undefined, [{type: "remove", id: retry}])
  expect(fresh.stats().total).toBe(2)
})

test("readonly schema3 summaries не открывают index и не меняют источник", async () => {
  const f = await fixture()
  const archive = await f.open()
  await archive.commit(undefined, [message("saved")])
  const source = await readFile(f.file, "utf8")
  await archive.dispose()
  await rm(archive.cacheFile)
  const states = await Promise.all(Array.from({length: 8}, () => readArchiveState(f.file)))
  for (const state of states) expect(state).toMatchObject({metadata: {id: "chat"}, history: {total: 1}})
  await expect(stat(archive.cacheFile)).rejects.toThrow()
  expect(await readFile(f.file, "utf8")).toBe(source)
})

test("tail/before сохраняют ближайшие новые UTF8 headers при малом byte budget; один oversized header даёт RangeError", async () => {
  const f = await fixture()
  const archive = await f.open()
  await archive.commit(undefined, Array.from({length: 6}, (_, index): ArchiveMutation => ({
    type: "append", item: {id: `tool:${index}`, kind: "tool", origin: "local", toolCallId: `call:${index}`,
      call: {sessionUpdate: "tool_call", toolCallId: `call:${index}`, title: `${"Ж🦊".repeat(60)}:${index}`}, updates: []},
  })))
  const complete = archive.page({limit: 6})
  const byteLength = (entry: typeof complete.items[number]) => Buffer.byteLength(JSON.stringify(entry))
  const newest = complete.items.at(-1)!
  expect(byteLength(newest)).toBeGreaterThan(JSON.stringify(newest).length)
  const budget = byteLength(complete.items[4]!) + byteLength(newest) + 3
  const tail = archive.page({limit: 6, maxBytes: budget})
  expect(tail.items.map(item => item.id)).toEqual(["tool:4", "tool:5"])
  expect(Buffer.byteLength(JSON.stringify(tail.items))).toBeLessThanOrEqual(budget)
  expect(tail.before).toBe(4)
  expect(tail.after).toBeNull()
  const before = archive.page({before: 4, limit: 6, maxBytes: budget})
  expect(before.items.map(item => item.id)).toEqual(["tool:2", "tool:3"])
  expect(before.before).toBe(2)
  expect(before.after).toBe(3)
  expect(() => archive.page({maxBytes: byteLength(newest)})).toThrow(RangeError)
  expect(archive.stats().total).toBe(6)
})

test("before evidence выбирает ближайшие события к границе и возвращает их ascending", async () => {
  const f = await fixture()
  const archive = await f.open()
  for (let index = 0; index < 6; index++) await archive.receive({sessionUpdate: "tool_call", toolCallId: "events", title: "История", rawOutput: `${"Я🦊".repeat(20)}:${index}`}, "live", {})
  const id = archive.findTool("events")!.id
  const complete = archive.evidence(id, {limit: 6})
  const budget = Buffer.byteLength(JSON.stringify(complete.items[4])) + Buffer.byteLength(JSON.stringify(complete.items[5]))
  const page = archive.evidence(id, {before: 6, limit: 6, maxBytes: budget})
  expect(page.items.map(item => (item.update as {rawOutput: string}).rawOutput.slice(-2))).toEqual([":4", ":5"])
  expect(page.start).toBe(4)
  expect(page.before).toBe(4)
  expect(page.after).toBeNull()
  const older = archive.evidence(id, {before: page.before!, limit: 6, maxBytes: budget})
  expect(older.items.map(item => (item.update as {rawOutput: string}).rawOutput.slice(-2))).toEqual([":2", ":3"])
  expect(older.before).toBe(2)
  expect(older.after).toBe(3)
  const one = archive.evidence(id, {before: 6, maxBytes: 1})
  expect(one.items.map(item => (item.update as {rawOutput: string}).rawOutput.slice(-2))).toEqual([":5"])
  expect(one.before).toBe(5)
})

test("параллельные legacy открытия публикуют один corpus и не затирают чужую миграцию", async () => {
  const f = await fixture()
  const original = JSON.stringify({...f.metadata, schemaVersion: 2, timeline: Array.from({length: 128}, (_, index) => ({
    id: `legacy:${index}`, sequence: index + 1, kind: "message", role: "user", origin: "local", content: [{type: "text", text: `Сообщение${index}`}],
  }))})
  await Bun.write(f.file, original)
  const opened = await Promise.all([f.open(), f.open()])
  expect(opened.every(archive => archive.stats().total === 128)).toBeTrue()
  expect(opened[0]!.sourceHeader().journal).toBe(opened[1]!.sourceHeader().journal)
  expect(await readFile(`${f.file}.schema2`, "utf8")).toBe(original)
  await opened[0]!.commit(undefined, [message("after-migration")])
  const latest = await f.open()
  expect(latest.stats().total).toBe(129)
  expect(latest.lookup("after-migration")).not.toBeNull()
})

test("1000 одиночных updates на 1000 и 100000 entries используют индексы и не сканируют весь corpus", async () => {
  const measurements: {entries: number; updateMs: number; meanUpdateMs: number; metadataMs: number; queryMs: number}[] = []
  for (const entries of [1000, 100_000]) {
    const f = await fixture()
    const archive = await f.open()
    await archive.receive({sessionUpdate: "tool_call", toolCallId: "cold-tool", title: "Поток", status: "in_progress"}, "live", {})
    await archive.commit(undefined, [
      {type: "append", item: {id: "started-completed", kind: "turn", requestId: "completed", state: "started", origin: "local"}},
      {type: "append", item: {id: "completed", kind: "turn", requestId: "completed", state: "completed", origin: "local"}},
      {type: "append", item: {id: "started", kind: "turn", requestId: "interrupted", state: "started", origin: "local"}},
    ])
    for (let start = 0; start < entries; start += 1000) await archive.commit(undefined, Array.from({length: 1000}, (_, index) => message(`user:${start + index}`)))
    const start = performance.now()
    for (let index = 0; index < 1000; index++) await archive.receive({sessionUpdate: "tool_call_update", toolCallId: "cold-tool", rawOutput: {index}}, "live", {})
    const updateMs = performance.now() - start
    const metadataStart = performance.now()
    for (let index = 0; index < 100; index++) await archive.commit({...archive.metadata, error: `status:${index}`})
    const metadataMs = performance.now() - metadataStart
    const queryStart = performance.now()
    for (let index = 0; index < 1000; index++) {
      expect(archive.hasStarted("interrupted")).toBeTrue()
      expect(archive.hasStarted("absent")).toBeFalse()
      expect(archive.unfinishedRequest()).toBe("interrupted")
      expect(archive.lastAssistant(archive.stats().lastSequence + 1)).toBeNull()
    }
    const queryMs = performance.now() - queryStart
    expect(archive.stats().total).toBe(entries + 4)
    expect(archive.findTool("cold-tool")?.evidenceCount).toBe(1001)
    const db = new Database(archive.cacheFile, {readonly: true})
    try {
      const queries = [
        "SELECT 1 FROM entry WHERE kind='turn' AND json_extract(data,'$.requestId')='absent' AND json_extract(preview,'$.state')='started' LIMIT 1",
        "SELECT json_extract(data,'$.requestId') FROM entry WHERE kind='turn' AND json_extract(preview,'$.state')='started' ORDER BY ordinal DESC LIMIT 1",
        "SELECT 1 FROM entry WHERE kind='turn' AND json_extract(data,'$.requestId')='interrupted' AND json_extract(preview,'$.state')!='started' LIMIT 1",
        "SELECT id FROM entry WHERE kind='message' AND sequence>1000000 AND json_extract(preview,'$.role')='assistant' ORDER BY sequence DESC LIMIT 1",
      ]
      for (const query of queries) {
        const plan = db.query(`EXPLAIN QUERY PLAN ${query}`).all() as {detail: string}[]
        expect(plan.some(row => /USING INDEX (started_request|started_turn|terminal_request|assistant_entry)/u.test(row.detail))).toBeTrue()
        expect(plan.some(row => /^SCAN entry$/u.test(row.detail))).toBeFalse()
      }
    } finally { db.close() }
    measurements.push({entries, updateMs, meanUpdateMs: updateMs / 1000, metadataMs, queryMs})
    await archive.dispose()
  }
  // Время ФС шумит, но рост corpus в100раз не должен превращать updates в полный обход.
  expect(measurements[1]!.updateMs).toBeLessThan(measurements[0]!.updateMs * 6 + 1000)
  expect(measurements[1]!.queryMs).toBeLessThan(measurements[0]!.queryMs * 6 + 100)
  if (process.env.CHAT_ARCHIVE_BENCHMARK === "1") console.log(JSON.stringify({operation: "single-update-comparison", updates: 1000, metadataCommits: 100, indexedLookupIterations: 1000, measurements}))
}, 120_000)
