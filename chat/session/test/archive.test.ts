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

test.each(["user-first", "context-first"])("собственный bootstrap replay %s остаётся context с canonical вопросом, raw evidence и cold rebuild", async order => {
  const f = await fixture()
  let archive = await f.open()
  const bootstrap = {type: "text" as const, text: JSON.stringify({environment: {
    executorId: f.metadata.executorId, subject: {address: f.metadata.address}, instructions: "Правила ".repeat(5000),
  }})}
  const question = {type: "text" as const, text: "какие инструменты ты видешь у себя?"}
  const input: ArchiveMutation[] = [message("user:original", question.text),
    {type: "append", item: {id: "own-context", kind: "context", origin: "local", requestId: "original", content: [bootstrap]}}]
  await archive.commit(undefined, order === "user-first" ? input : input.reverse())
  const events = [bootstrap, question].map(content => ({sessionUpdate: "user_message_chunk" as const, messageId: "native-user",
    content: {text: content.text, type: content.type}}))
  const cursor = {}
  for (const event of events) await archive.receive(event, "replay", cursor)
  const id = archive.findProvider("user", "native-user")!.id
  const originalHeader = JSON.parse(await readFile(f.file, "utf8"))
  const journal = join(f.root, "meta/chat", originalHeader.journal)
  const originalSource = await readFile(journal, "utf8")
  const assertProjection = () => {
    expect(archive.page().items.find(item => item.id === id)).toMatchObject({kind: "context", evidenceCount: 2})
    expect(archive.body(id).entry).toMatchObject({id, kind: "context", requestId: "original", content: [bootstrap]})
    expect(archive.body("user:original").entry).toMatchObject({kind: "message", role: "user", content: [question]})
    expect(archive.content(id)).toEqual([bootstrap, question])
    expect(archive.evidence(id).items.map(event => event.update)).toEqual(events)
    expect(archive.stats().total).toBe(3)
    expect(archive.residency().entries).toBe(0)
  }
  assertProjection()
  await archive.dispose()
  await rm(archive.cacheFile)
  archive = await f.open()
  assertProjection()
  const readContent = archive.content.bind(archive)
  const readIds: string[] = []
  archive.content = id => { readIds.push(id); return readContent(id) }
  for (let index = 0; index < 10; index++) archive.page()
  expect(readIds).toEqual([])
  archive.body(id)
  expect(readIds).toEqual(["own-context"])
  expect(await readFile(journal, "utf8")).toBe(originalSource)
  expect(JSON.parse(await readFile(f.file, "utf8"))).toEqual(originalHeader)
})

test.each([
  {name: "без собственного supplied context", supplied: false, scope: true, question: true, identity: true},
  {name: "другого адреса", supplied: true, scope: false, question: true, identity: true},
  {name: "с другим вопросом", supplied: true, scope: true, question: false, identity: true},
  {name: "без provider identity", supplied: true, scope: true, question: true, identity: false},
])("несопоставленный user replay $name сохраняет пользовательский JSON", async props => {
  const f = await fixture()
  const archive = await f.open()
  const bootstrap = {type: "text" as const, text: JSON.stringify({environment: {executorId: f.metadata.executorId,
    subject: {address: props.scope ? f.metadata.address : "/other"}}})}
  await archive.commit(undefined, [message("user:original", "Вопрос"),
    ...(props.supplied ? [{type: "append" as const, item: {id: "own-context", kind: "context" as const, origin: "local" as const,
      requestId: "original", content: [bootstrap]}}] : [])])
  const cursor = {}
  for (const content of [bootstrap, {type: "text" as const, text: props.question ? "Вопрос" : "Другой вопрос"}]) {
    await archive.receive({sessionUpdate: "user_message_chunk", ...(props.identity ? {messageId: "native-user"} : {}), content}, "replay", cursor)
  }
  for (const item of archive.page().items.filter(item => item.origin === "replay")) {
    expect(item).toMatchObject({kind: "message", role: "user"})
    expect(archive.body(item.id).entry).toMatchObject({kind: "message", role: "user"})
  }
})

test("неоднозначный собственный bootstrap replay сворачивает точный контекст без угадывания requestId", async () => {
  const f = await fixture()
  const archive = await f.open()
  const bootstrap = {type: "text" as const, text: JSON.stringify({environment: {executorId: f.metadata.executorId,
    subject: {address: f.metadata.address}}})}
  for (const requestId of ["one", "two"]) await archive.commit(undefined, [message(`user:${requestId}`, "Вопрос"),
    {type: "append", item: {id: `context:${requestId}`, kind: "context", origin: "local", requestId, content: [bootstrap]}}])
  const cursor = {}
  for (const content of [bootstrap, {type: "text" as const, text: "Вопрос"}]) {
    await archive.receive({sessionUpdate: "user_message_chunk", messageId: "native-user", content}, "replay", cursor)
  }
  const id = archive.findProvider("user", "native-user")!.id
  const entry = archive.body(id).entry
  expect(entry).toMatchObject({kind: "context", content: [bootstrap]})
  expect(entry).not.toHaveProperty("requestId")
  expect(archive.content(id)).toEqual([bootstrap, {type: "text", text: "Вопрос"}])
  expect(archive.evidence(id).items).toHaveLength(2)
  for (const requestId of ["one", "two"]) expect(archive.body(`user:${requestId}`).entry).toMatchObject({kind: "message", role: "user"})
  const source = await readFile(f.file, "utf8")
  await archive.dispose()
  await rm(archive.cacheFile)
  const restored = await f.open()
  expect(restored.body(id).entry).toMatchObject({kind: "context", content: [bootstrap]})
  expect(restored.body(id).entry).not.toHaveProperty("requestId")
  expect(await readFile(f.file, "utf8")).toBe(source)
})

test("собственный bootstrap replay получает projection при позднем input и снимает только requestId при неоднозначности", async () => {
  const f = await fixture()
  const archive = await f.open()
  const bootstrap = {type: "text" as const, text: JSON.stringify({environment: {executorId: f.metadata.executorId,
    subject: {address: f.metadata.address}}})}
  const cursor = {}
  for (const content of [bootstrap, {type: "text" as const, text: "Вопрос"}]) {
    await archive.receive({sessionUpdate: "user_message_chunk", messageId: "native-user", content}, "replay", cursor)
  }
  const id = archive.findProvider("user", "native-user")!.id
  expect(archive.body(id).entry).toMatchObject({kind: "message", role: "user"})
  const input = (requestId: string): ArchiveMutation[] => [
    {type: "append", item: {id: `context:${requestId}`, kind: "context", origin: "local", requestId, content: [bootstrap]}},
    message(`user:${requestId}`, "Вопрос"),
  ]
  await archive.commit(undefined, input("one"))
  expect(archive.body(id).entry).toMatchObject({kind: "context", requestId: "one"})
  const revision = archive.body(id).revision
  await archive.commit(undefined, input("two"))
  expect(archive.body(id).entry).toMatchObject({kind: "context", content: [bootstrap]})
  expect(archive.body(id).entry).not.toHaveProperty("requestId")
  expect(archive.body(id).revision).toBeGreaterThan(revision)
})

test("прежний cache с обязательным requestId пересобирается без изменения journal", async () => {
  const f = await fixture()
  const archive = await f.open()
  const bootstrap = {type: "text" as const, text: JSON.stringify({environment: {
    executorId: f.metadata.executorId, subject: {address: f.metadata.address},
  }})}
  for (const requestId of ["one", "two", "three"]) await archive.commit(undefined, [
    message(`user:${requestId}`, "Вопрос"),
    {type: "append", item: {id: `context:${requestId}`, kind: "context", origin: "local", requestId, content: [bootstrap]}},
  ])
  const cursor = {}
  for (const content of [bootstrap, {type: "text" as const, text: "Вопрос"}]) {
    await archive.receive({sessionUpdate: "user_message_chunk", messageId: "native-user", content}, "replay", cursor)
  }
  const id = archive.findProvider("user", "native-user")!.id
  const header = await readFile(f.file, "utf8")
  const journal = join(f.root, "meta/chat", JSON.parse(header).journal)
  const source = await readFile(journal, "utf8")
  await archive.dispose()
  const db = new Database(archive.cacheFile)
  db.exec(`DROP TABLE replay_projection;
    CREATE TABLE replay_projection (entry_id TEXT PRIMARY KEY, context_id TEXT NOT NULL, request_id TEXT NOT NULL, body_bytes INTEGER NOT NULL);`)
  db.close()
  const restored = await f.open()
  expect(restored.body(id).entry).toMatchObject({kind: "context", content: [bootstrap]})
  expect(restored.body(id).entry).not.toHaveProperty("requestId")
  expect(restored.content(id)).toEqual([bootstrap, {type: "text", text: "Вопрос"}])
  expect(await readFile(f.file, "utf8")).toBe(header)
  expect(await readFile(journal, "utf8")).toBe(source)
})

test.each([
  {name: "отдельные chunks", bootstrap: false, merged: false},
  {name: "один text block", bootstrap: false, merged: true},
  {name: "bootstrap и image", bootstrap: true, merged: false},
])("собственный image echo $name возвращает typed context и сохраняет source при cold rebuild", async props => {
  const f = await fixture()
  let archive = await f.open()
  const content = [{type: "text" as const, text: "что видишь тут?"},
    {type: "image" as const, mimeType: "image/png", data: Buffer.alloc(750_000).toString("base64")}]
  const bootstrap = {type: "text" as const, text: JSON.stringify({environment: {executorId: f.metadata.executorId,
    subject: {address: f.metadata.address}}})}
  await archive.commit(undefined, [
    {type: "append", item: {id: "user:picture", kind: "message", role: "user", origin: "local", content}},
    ...(props.bootstrap ? [{type: "append" as const, item: {id: "own-context", kind: "context" as const, origin: "local" as const, requestId: "picture", content: [bootstrap]}}] : []),
    {type: "append", item: {id: "start", kind: "turn", origin: "local", requestId: "picture", state: "started"}},
  ])
  const echo = `[@image](data:${content[1]!.mimeType};base64,${content[1]!.data})`
  const raw = [...(props.bootstrap ? [bootstrap] : []), content[0]!, {type: "text" as const, text: echo}]
  const events = (props.merged ? [{type: "text" as const, text: raw.map(block => block.text).join("")}] : raw)
    .map(block => ({sessionUpdate: "user_message_chunk" as const, messageId: "native-picture", content: block}))
  const replayCursor = {}
  for (const event of events) await archive.receive(event, "replay", replayCursor)
  const id = archive.findProvider("user", "native-picture")!.id
  const header = JSON.parse(await readFile(f.file, "utf8"))
  const journal = join(f.root, "meta/chat", header.journal)
  const source = await readFile(journal, "utf8")
  const assertProjection = async () => {
    expect(archive.page().items.find(item => item.id === id)).toMatchObject({kind: "context"})
    const body = archive.body(id)
    expect(body.entry).toMatchObject({kind: "context", requestId: "picture", content: props.bootstrap ? [bootstrap] : await archive.media.normalize(content)})
    expect(archive.body("user:picture").entry).toMatchObject({kind: "message", role: "user", content: await archive.media.normalize(content)})
    const evidence: unknown[] = []
    let after: number | undefined
    for (;;) {
      const page = archive.evidence(id, after === undefined ? {} : {after})
      evidence.push(...page.items.map(event => event.update))
      if (page.after === null) break
      after = page.after
    }
    expect(await archive.media.materialize(evidence)).toEqual(events)
    expect(await archive.media.materialize(archive.content("user:picture"))).toEqual(content)
    expect(source).not.toContain(content[1]!.data)
    expect(archive.residency().entries).toBe(0)
  }
  await assertProjection()
  await archive.dispose()
  await rm(archive.cacheFile)
  archive = await f.open()
  await assertProjection()
  expect(await readFile(journal, "utf8")).toBe(source)
  expect(JSON.parse(await readFile(f.file, "utf8"))).toEqual(header)
})

test.each([
  {name: "только пользовательский Markdown link", image: false, started: true, data: "AA==", question: "Вопрос"},
  {name: "ещё не начатый image input", image: true, started: false, data: "AA==", question: "Вопрос"},
  {name: "другие байты изображения", image: true, started: true, data: "AQ==", question: "Вопрос"},
  {name: "другой вопрос", image: true, started: true, data: "AA==", question: "Другой вопрос"},
])("несопоставленный image echo $name не декодирует произвольный link", async props => {
  const f = await fixture()
  const archive = await f.open()
  const text = "Вопрос[@image](data:image/png;base64,AA==)"
  const content = props.image ? [{type: "text" as const, text: "Вопрос"}, {type: "image" as const, mimeType: "image/png", data: "AA=="}]
    : [{type: "text" as const, text}]
  await archive.commit(undefined, [{type: "append", item: {id: "user:picture", kind: "message", role: "user", origin: "local", content}},
    ...(props.started ? [{type: "append" as const, item: {id: "start", kind: "turn" as const, origin: "local" as const, requestId: "picture", state: "started" as const}}] : [])])
  const echo = props.image ? `${props.question}[@image](data:image/png;base64,${props.data})` : text
  await archive.receive({sessionUpdate: "user_message_chunk", messageId: "native-picture", content: {type: "text", text: echo}}, "replay", {})
  const id = archive.findProvider("user", "native-picture")!.id
  expect(archive.page().items.find(item => item.id === id)).toMatchObject({kind: "message", role: "user"})
  expect(archive.body(id).entry).toMatchObject({kind: "message", content: archive.media.project(await archive.media.normalize([{type: "text", text: echo}]))})
  expect(await archive.media.materialize(archive.content(id))).toEqual([{type: "text", text: echo}])
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
  expect(await archive.media.materialize(archive.content("media"))).toEqual(content)
  await archive.dispose()
  await rm(archive.cacheFile)
  archive = await f.open()
  expect(await archive.media.materialize(archive.content("media"))).toEqual(content)
  expect(archive.body("media").entry).toMatchObject({content: await archive.media.normalize(content)})
  expect(archive.hasMedia("6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d")).toBeTrue()
})

test("большой tool body читается порциями; oversized evidence не загружается целиком", async () => {
  const f = await fixture()
  const archive = await f.open()
  await archive.receive({sessionUpdate: "tool_call", toolCallId: "oversized", title: "Большой результат", rawOutput: "a".repeat(17 * 1024 * 1024)}, "live", {})
  const entry = archive.findTool("oversized")!
  expect(entry.bodyBytes).toBeGreaterThan(16 * 1024 * 1024)
  expect(Buffer.byteLength(JSON.stringify(archive.page()))).toBeLessThan(1024)
  expect(archive.body(entry.id).bytes).toBeLessThan(65536)
  expect(archive.body(entry.id).detail?.next).toBeGreaterThan(0)
  expect(() => archive.evidence(entry.id)).toThrow("16 MiB")
  const header = JSON.parse(await readFile(f.file, "utf8"))
  expect((await stat(join(f.root, "meta/chat", header.journal))).size).toBeGreaterThan(17 * 1024 * 1024)
  await archive.dispose()
  const restored = await f.open()
  expect(restored.findTool("oversized")!.id).toBe(entry.id)
  expect(restored.body(entry.id).detail?.sourceBytes).toBeGreaterThan(16 * 1024 * 1024)
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

test("удаление отдельного маркера не сканирует растущие таблицы replay-сопоставлений", async () => {
  const f = await fixture()
  const archive = await f.open()
  await archive.commit(f.metadata, [message("user:one")])
  const db = new Database(archive.cacheFile, {readonly: true})
  try {
    for (const [table, predicate, args] of [
      ["supplied_input", "context_id=? OR request_id=?", ["other-marker", ""]],
      ["replay_projection", "entry_id=? OR context_id=? OR request_id=?", ["other-marker", "other-marker", ""]],
    ] as const) {
      const plan = db.query(`EXPLAIN QUERY PLAN DELETE FROM ${table} WHERE ${predicate}`).all(...args) as {detail: string}[]
      expect(plan.some(row => row.detail.includes("MULTI-INDEX OR"))).toBe(true)
      expect(plan.some(row => row.detail.includes(`SCAN ${table}`))).toBe(false)
    }
  } finally {db.close()}
})

test("перенос корпуса между владельцами переносит binary originals до публикации header", async () => {
  const f = await fixture()
  const archive = await f.open()
  const content = [{type: "image" as const, mimeType: "image/png", data: "AQID"}]
  await archive.commit(undefined, [{type: "append", item: {id: "image", kind: "message", role: "user", origin: "local", content}}])
  const destination = join(f.root, "other/meta/chat/copy.json")
  await copyArchive(f.file, destination, {...f.metadata, address: "/copy"})
  const copied = await f.open(destination, {...f.metadata, address: "/copy"})
  expect(await copied.media.materialize(copied.content("image"))).toEqual(content)
  expect(await archive.media.materialize(archive.content("image"))).toEqual(content)
  expect(copied.hasMedia("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81")).toBeTrue()
})

test("сохранение неизменных metadata не пишет журнал, но изменение остаётся durable", async () => {
  const f = await fixture()
  const archive = await f.open()
  await archive.commit(f.metadata, [message("one")])
  const first = await readFile(f.file, "utf8")
  const header = JSON.parse(first)
  const journal = join(f.root, "meta/chat", header.journal)
  const originalBytes = (await stat(journal)).size
  for (let i = 0; i < 20; i++) await archive.commit(archive.metadata)
  expect(await readFile(f.file, "utf8")).toBe(first)
  expect((await stat(journal)).size).toBe(originalBytes)
  await archive.commit({...archive.metadata, sessionLabel: "Сохранённое имя"})
  expect((await stat(journal)).size).toBeGreaterThan(originalBytes)
  expect(JSON.parse(await readFile(f.file, "utf8")).metadata.sessionLabel).toBe("Сохранённое имя")
})

test("чтение во время durable записи видит только целиком подтверждённый индекс", async () => {
  const f = await fixture()
  const archive = await f.open()
  await archive.commit(f.metadata, [message("first")])
  let completed = false
  let observed = 0
  const writing = archive.commit(undefined, Array.from({length: 1000}, (_, i) => message(`next:${i}`, "x".repeat(1000)))).then(() => {completed = true})
  while (!completed) {
    const page = archive.page({around: 0})
    expect([1, 1001]).toContain(page.total)
    expect(page.items.length).toBe(page.total === 1 ? 1 : 32)
    observed++
    await Bun.sleep(0)
  }
  await writing
  expect(observed).toBeGreaterThan(0)
  expect(archive.stats().total).toBe(1001)
  expect(archive.page({around: 0}).items[0]?.id).toBe("first")
})
