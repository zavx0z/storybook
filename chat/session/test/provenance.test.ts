import {afterEach, expect, test} from "bun:test"
import {Database} from "bun:sqlite"
import {mkdtemp, readFile, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {openArchive, type ArchiveMetadata, type ArchiveMutation} from "../src/archive"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close()})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chat-provenance-"))
  cleanup.push(() => rm(root, {recursive: true, force: true}))
  const file = join(root, "chat.json")
  const metadata: ArchiveMetadata = {id: "chat", executorId: "executor", executorLabel: "Агент", address: "/", pending: [], historyComplete: true, status: "idle", error: null}
  const open = async () => {
    const archive = await openArchive(file, metadata)
    cleanup.push(() => archive.dispose())
    return archive
  }
  return {root, file, open}
}
const user = (requestId: string, text = "Покажи файлы"): ArchiveMutation => ({type: "append", item: {
  id: `user:${requestId}`, kind: "message", origin: "local", role: "user", content: [{type: "text", text}], receivedAt: "2026-10-07T02:53:00.000Z",
}})
const start = (requestId: string): ArchiveMutation => ({type: "append", item: {id: `start:${requestId}`, kind: "turn", origin: "local", requestId, state: "started"}})
const context = (id: string, requestId: string, text: string): ArchiveMutation => ({type: "append", item: {
  id, kind: "context", origin: "local", requestId, content: [{type: "text", text}], receivedAt: "2026-10-07T02:54:06.129Z",
}})
// Точный text наблюдавшегося результата filesystem.list из local context 4092f35b.
const observed = "{\"result\":{\"path\":\".\",\"entries\":[{\"path\":\"contract\",\"type\":\"directory\",\"size\":96,\"mode\":493,\"modifiedAt\":\"2026-10-05T16:26:35.045Z\"},{\"path\":\"index.tsx\",\"type\":\"file\",\"size\":3100,\"mode\":420,\"modifiedAt\":\"2026-10-06T22:26:11.019Z\"},{\"path\":\"meta\",\"type\":\"directory\",\"size\":128,\"mode\":493,\"modifiedAt\":\"2026-10-07T01:54:23.682Z\"},{\"path\":\"package.json\",\"type\":\"file\",\"size\":1244,\"mode\":420,\"modifiedAt\":\"2026-10-05T18:12:03.512Z\"},{\"path\":\"spec\",\"type\":\"directory\",\"size\":96,\"mode\":493,\"modifiedAt\":\"2026-10-05T16:47:45.507Z\"},{\"path\":\"src\",\"type\":\"directory\",\"size\":160,\"mode\":493,\"modifiedAt\":\"2026-10-05T17:39:59.824Z\"},{\"path\":\"test\",\"type\":\"directory\",\"size\":96,\"mode\":493,\"modifiedAt\":\"2026-10-05T17:40:49.407Z\"}],\"truncated\":false,\"depthLimited\":false}}"

const replay = (text: string, messageId = "native-result") => ({sessionUpdate: "user_message_chunk" as const, messageId, content: {type: "text" as const, text}})

test("наблюдавшийся результат команды остаётся служебным: время, requestId, одна группа и raw evidence", async () => {
  const f = await fixture()
  let archive = await f.open()
  await archive.commit(undefined, [user("r"), start("r"), context("result", "r", observed)])
  await archive.receive(replay(observed), "replay", {})
  const id = archive.findProvider("user", "native-result")!.id
  const assertProjection = () => {
    expect(archive.body(id).entry).toMatchObject({kind: "context", requestId: "r", receivedAt: "2026-10-07T02:54:06.129Z", content: [{type: "text", text: observed}]})
    expect(archive.page().items.find(item => item.id === id)).toMatchObject({kind: "context", receivedAt: "2026-10-07T02:54:06.129Z"})
    expect(archive.content(id).map(block => block.type === "text" ? block.text : "").join("")).toBe(observed)
    expect(archive.display().items.map(item => item.id)).toEqual(["user:r", "service:user:user:r"])
    expect(archive.groupPage("service:user:user:r").items.map(item => item.entryId)).toEqual(["start:r", "result"])
    expect(archive.evidence(id).items[0]!.update).toEqual(replay(observed))
  }
  assertProjection()
  for (let reload = 0; reload < 3; reload++) {
    await archive.receive(replay(observed.slice(0, 60)), "replay", {batchId: `reload:${reload}`})
    await archive.receive(replay(observed.slice(60)), "replay", {batchId: `reload:${reload}`})
    assertProjection()
    expect(archive.stats().total).toBe(4)
    await archive.dispose()
    archive = await f.open()
    assertProjection()
  }
  const header = await readFile(f.file, "utf8")
  const journal = join(f.root, JSON.parse(header).journal)
  const bytes = await readFile(journal, "utf8")
  await archive.dispose()
  await rm(archive.cacheFile)
  archive = await f.open()
  assertProjection()
  expect(await readFile(journal, "utf8")).toBe(bytes)
  expect(await readFile(f.file, "utf8")).toBe(header)
})

test("настоящий identical JSON человека сохраняется; неоднозначный replay не получает чужой requestId", async () => {
  const f = await fixture()
  const archive = await f.open()
  await archive.commit(undefined, [user("r"), start("r"), context("result", "r", observed)])
  await archive.receive(replay(observed), "replay", {})
  const id = archive.findProvider("user", "native-result")!.id
  expect(archive.body(id).entry.kind).toBe("context")
  await archive.commit(undefined, [user("human", observed), start("human")])
  expect(archive.body("user:human").entry).toMatchObject({kind: "message", role: "user", content: [{type: "text", text: observed}]})
  expect(archive.body(id).entry).toMatchObject({kind: "message", role: "user", authorship: "unresolved", diagnostic: expect.stringContaining("не установлены")})
  expect(archive.body(id).entry).not.toHaveProperty("requestId")
  expect(archive.body(id).entry).not.toHaveProperty("receivedAt")
  expect(archive.page().items.find(item => item.id === id)).toMatchObject({authorship: "unresolved"})
  expect(archive.display().items.some(item => item.id === "user:human")).toBeTrue()
  expect(archive.body("result").entry.kind).toBe("context")
})

test("late context переводит уже показанный replay в исходную группу; другой JSON остаётся сообщением", async () => {
  const f = await fixture()
  const archive = await f.open()
  await archive.commit(undefined, [user("r"), start("r")])
  await archive.receive(replay(observed), "replay", {})
  const id = archive.findProvider("user", "native-result")!.id
  await archive.commit(undefined, [context("result", "r", observed)])
  expect(archive.body(id).entry).toMatchObject({kind: "context", requestId: "r"})
  expect(archive.display().items.map(item => item.id)).toEqual(["user:r", "service:user:user:r"])
  expect(archive.groupPage("service:user:user:r").items.map(item => item.entryId)).toEqual(["start:r", "result"])
  await archive.receive(replay('{"result":"человеческий JSON"}', "unknown"), "replay", {})
  expect(archive.body(archive.findProvider("user", "unknown")!.id).entry).toMatchObject({kind: "message", role: "user"})
})

test.each(["до start", "без start"])("context %s не доказывает отдельно отправленный результат", async mode => {
  const f = await fixture()
  const archive = await f.open()
  await archive.commit(undefined, [user("r"), context("context", "r", observed), ...(mode === "до start" ? [start("r")] : [])])
  await archive.receive(replay(observed), "replay", {})
  expect(archive.body(archive.findProvider("user", "native-result")!.id).entry.kind).toBe("message")
})

test("legacy v5 cache перестраивает авторство без изменения journal/header", async () => {
  const f = await fixture()
  let archive = await f.open()
  await archive.commit(undefined, [user("r"), start("r"), context("result", "r", observed)])
  await archive.receive(replay(observed), "replay", {})
  const id = archive.findProvider("user", "native-result")!.id
  const header = await readFile(f.file, "utf8")
  const journal = join(f.root, JSON.parse(header).journal)
  const original = await readFile(journal, "utf8")
  const cacheFile = archive.cacheFile
  await archive.dispose()
  const db = new Database(cacheFile)
  db.exec("DELETE FROM replay_projection; INSERT OR REPLACE INTO display_message SELECT id,sequence,'user' FROM entry WHERE origin='replay'; UPDATE stamp SET value=replace(value,'display-occurrences-v7:','display-occurrences-v5:') WHERE key='source';")
  db.close()
  archive = await f.open()
  expect(archive.body(id).entry).toMatchObject({kind: "context", requestId: "r"})
  expect(archive.display().items.map(item => item.id)).toEqual(["user:r", "service:user:user:r"])
  expect(await readFile(journal, "utf8")).toBe(original)
  expect(await readFile(f.file, "utf8")).toBe(header)
})

test("несколько одинаковых служебных отправок не получают выдуманную корреляцию", async () => {
  const f = await fixture()
  const archive = await f.open()
  await archive.commit(undefined, [user("one"), start("one"), context("first", "one", observed),
    user("two"), start("two"), context("second", "two", observed)])
  await archive.receive(replay(observed), "replay", {})
  const id = archive.findProvider("user", "native-result")!.id
  expect(archive.body(id).entry).not.toHaveProperty("requestId")
  expect(archive.body(id).entry).not.toHaveProperty("receivedAt")
  expect(archive.page().items.find(item => item.id === id)).toMatchObject({authorship: "unresolved"})
  expect(archive.body(id).entry).toMatchObject({diagnostic: expect.stringContaining("не установлены")})
  expect(archive.groupPage("service:user:user:one").items.map(item => item.entryId)).toEqual(["start:one", "first"])
  expect(archive.groupPage("service:user:user:two").items.map(item => item.entryId)).toEqual(["start:two", "second"])
})

test("отдельный typed context сопоставляется по блокам, а replay без native identity остаётся исходным", async () => {
  const f = await fixture()
  const archive = await f.open()
  const content = [{type: "resource" as const, resource: {uri: "context://result", text: "Результат", mimeType: "text/plain"}},
    {type: "text" as const, text: "Пояснение"}]
  await archive.commit(undefined, [user("r"), start("r"), {type: "append", item: {
    id: "typed", kind: "context", origin: "local", requestId: "r", content,
  }}])
  const cursor = {}
  for (const block of content) await archive.receive({sessionUpdate: "user_message_chunk", messageId: "typed-native", content: block}, "replay", cursor)
  const id = archive.findProvider("user", "typed-native")!.id
  expect(archive.body(id).entry).toMatchObject({kind: "context", requestId: "r", content})
  expect(archive.groupPage("service:user:user:r").items.map(item => item.entryId)).toEqual(["start:r", "typed"])
  await archive.receive({sessionUpdate: "user_message_chunk", content: content[0]!}, "replay", {})
  const unidentified = archive.page().items.at(-1)!
  expect(archive.body(unidentified.id).entry).toMatchObject({kind: "message", diagnostic: expect.stringContaining("не установлено")})
})

test("сопоставление service context использует request indexes без обхода entry", async () => {
  const f = await fixture()
  const archive = await f.open()
  await archive.commit(undefined, [user("r"), start("r"), context("result", "r", observed)])
  const db = new Database(archive.cacheFile, {readonly: true})
  try {
    for (const [sql, parameter] of [
      ["SELECT sequence FROM entry WHERE kind='turn' AND origin='local' AND json_extract(preview,'$.state')='started' AND json_extract(data,'$.requestId')=? LIMIT 1", "r"],
      [`SELECT 1 FROM entry context JOIN entry started
        ON json_extract(started.data,'$.requestId')=json_extract(context.data,'$.requestId')
        WHERE context.id=? AND started.kind='turn' AND json_extract(started.preview,'$.state')='started'
          AND context.sequence>started.sequence LIMIT 1`, "result"],
    ] as const) {
      const plan = db.query(`EXPLAIN QUERY PLAN ${sql}`).all(parameter) as {detail: string}[]
      expect(plan.some(row => row.detail.includes("USING INDEX started_request"))).toBeTrue()
      expect(plan.some(row => /^SCAN (entry|context|started)\b/u.test(row.detail))).toBeFalse()
    }
  } finally {db.close()}
})

test("несопоставленный replay виден нейтрально и не разделяет группу действий", async () => {
  const f = await fixture()
  const archive = await f.open()
  await archive.commit(undefined, [user("r"), start("r")])
  await archive.receive(replay("Внешний текст истории", "unknown"), "replay", {})
  const id = archive.findProvider("user", "unknown")!.id
  await archive.commit(undefined, [context("after", "r", "Другой результат")])
  const header = archive.display().items.find(item => item.id === id)!
  expect(header).toMatchObject({kind: "message", role: "user", authorship: "unresolved"})
  expect(header).not.toHaveProperty("receivedAt")
  expect(archive.body(id).entry).toMatchObject({kind: "message", role: "user", authorship: "unresolved"})
  expect(archive.body(id).entry).not.toHaveProperty("receivedAt")
  expect(archive.groupPage("service:user:user:r").items.map(item => item.entryId)).toEqual(["start:r", "after"])
  expect(archive.evidence(id).items[0]!.receivedAt).toBeDefined()
  expect(archive.evidence(id).items[0]!.update).toEqual(replay("Внешний текст истории", "unknown"))
})

test("большой service replay возвращает страницы исходного context, а не raw prompt chunks", async () => {
  const f = await fixture()
  const archive = await f.open()
  const text = "Результат🙂".repeat(40000)
  await archive.commit(undefined, [user("r"), start("r"), context("large", "r", text)])
  const cursor = {}
  await archive.receive(replay(text.slice(0, 50)), "replay", cursor)
  await archive.receive(replay(text.slice(50)), "replay", cursor)
  const id = archive.findProvider("user", "native-result")!.id
  const body = archive.body(id)
  expect(body.entry).toMatchObject({kind: "context", requestId: "r", receivedAt: "2026-10-07T02:54:06.129Z"})
  expect(body.continuation).toBeDefined()
  let result = body.entry.kind === "context" ? body.entry.content.map(block => block.type === "text" ? block.text : "").join("") : ""
  let next = body.continuation
  while (next !== undefined) {
    const page = archive.contentPage(id, {cursor: next})
    expect(page.id).toBe(id)
    expect(page.bytes).toBeLessThanOrEqual(64 * 1024)
    result += page.content.map(block => block.type === "text" ? block.text : "").join("")
    next = page.next ?? undefined
  }
  expect(result).toBe(text)
  expect(archive.content(id)).toHaveLength(2)
  await archive.receive(replay(text, "unmatched-large"), "replay", {})
  // После второго контекста одинаковый replay остаётся неоднозначным и нейтральным.
  await archive.commit(undefined, [context("large-again", "r", text)])
  const neutral = archive.body(archive.findProvider("user", "unmatched-large")!.id)
  expect(neutral.entry).toMatchObject({kind: "message", authorship: "unresolved"})
  expect(neutral.entry).not.toHaveProperty("receivedAt")
})
