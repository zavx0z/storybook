import {expect, test} from "bun:test"
import {Database} from "bun:sqlite"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {openArchive, type ArchiveMutation} from "../src/archive"

const user = (id: string): ArchiveMutation => ({type: "append", item: {id, kind: "message", role: "user", origin: "local", content: [{type: "text", text: id}]}})
const assistant = (id: string): ArchiveMutation => ({type: "append", item: {id, kind: "message", role: "assistant", origin: "live", content: [{type: "text", text: id}]}})
const service = (id: string): ArchiveMutation => ({type: "append", item: {id, kind: "event", origin: "live", update: {sessionUpdate: "usage_update", used: 1, size: 100}}})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "chat-groups-"))
  const metadata = {id: "chat", executorId: "executor", executorLabel: "Agent", address: "/", pending: [], historyComplete: true, status: "idle" as const, error: null}
  const archive = await openArchive(join(directory, "chat.json"), metadata)
  return {archive, directory, metadata, async close() {await archive.dispose(); await rm(directory, {recursive: true, force: true})}}
}
test("assistant не разделяет группу; raw корпус и полные counts не зависят от display page", async () => {
  const f = await fixture()
  try {
    await f.archive.commit(undefined, [user("u1"), service("s1"), assistant("a1"), service("s2"), assistant("a2"), user("u2"), service("s3")])
    const page = f.archive.display()
    expect(page.total).toBe(6)
    expect(page.rawTotal).toBe(7)
    expect(page.items.map(item => item.id)).toEqual(["u1", "service:user:u1", "a1", "a2", "u2", "service:user:u2"])
    expect(f.archive.groupPage("service:user:u1").items.map(item => item.entryId)).toEqual(["s1", "s2"])
    expect(f.archive.display({limit: 2}).items.map(item => item.id)).toEqual(["u2", "service:user:u2"])
  } finally {await f.close()}
})

test("display передаёт малые сообщения той же ревизии вместе с заголовками, детали остаются отдельными", async () => {
  const f = await fixture()
  try {
    await f.archive.commit(undefined, [user("u"), assistant("a"), service("event"),
      {type: "append", item: {id: "large", kind: "message", role: "assistant", origin: "live",
        content: [{type: "text", text: "x".repeat(32 * 1024)}]}}])
    const page = f.archive.display()
    expect(page.bodies?.map(body => body.id)).toEqual(["u", "a"])
    expect(Buffer.byteLength(JSON.stringify(page.bodies))).toBeLessThanOrEqual(64 * 1024)
    for (const body of page.bodies ?? []) {
      const header = page.items.find(item => item.id === body.id)!
      expect(body.revision).toBe(header.revision)
      expect(body.entry).toEqual(f.archive.body(body.id).entry)
    }
    expect(page.items.some(item => item.id === "large")).toBeTrue()
    expect(f.archive.body("large").entry.kind).toBe("message")
    expect(f.archive.groupPage("service:user:u").items.map(item => item.entryId)).toEqual(["event"])
  } finally {await f.close()}
})
test("счётчик сообщений и групп точен при разделении, слиянии, удалении, rollback и rebuild", async () => {
  const f = await fixture()
  const check = async (total: number) => {
    expect(f.archive.displayStats().total).toBe(total)
    const db = new Database(f.archive.cacheFile, {readonly: true})
    try {
      const actual = db.query("SELECT (SELECT COUNT(*) FROM display_message)+(SELECT COUNT(*) FROM service_group) AS total").get() as {total: number}
      expect(actual.total).toBe(total)
    } finally {db.close()}
  }
  try {
    await f.archive.commit(undefined, [user("u1"), service("s1"), user("u2"), service("s2"), assistant("a1")])
    await check(5)
    await f.archive.commit(undefined, [{type: "purpose", id: "u2"}])
    await check(3)
    expect(f.archive.groupPage("service:user:u1").total).toBe(3)
    await f.archive.commit(undefined, [{type: "remove", id: "s2"}, {type: "remove", id: "u2"}])
    await check(3)
    await f.archive.commit(undefined, [{type: "remove", id: "s1"}])
    await check(2)
    await f.archive.commit(undefined, [user("u3"), service("s3")])
    await check(4)
    await f.archive.commit(undefined, [{type: "remove", id: "u1"}])
    await check(3)
    await expect(f.archive.commit(undefined, [assistant("must-rollback"), {type: "purpose", id: "absent"}])).rejects.toThrow()
    await check(3)
    expect(f.archive.lookup("must-rollback")).toBeNull()
    const previous = f.archive.display()
    await f.archive.dispose()
    await rm(f.archive.cacheFile)
    const rebuilt = await openArchive(join(f.directory, "chat.json"), f.metadata)
    try {
      expect(rebuilt.displayStats().total).toBe(3)
      expect(rebuilt.display()).toEqual(previous)
      await rebuilt.commit({...rebuilt.metadata, error: "metadata-only"})
      expect(rebuilt.displayStats().total).toBe(3)
    } finally {await rebuilt.dispose()}
  } finally {await f.close()}
})
test("один tool пересекает user boundary по occurrences, причинный request прежний", async () => {
  const f = await fixture()
  try {
    await f.archive.commit({...f.metadata, activeRequest: "request1"}, [user("u1")])
    await f.archive.receive({sessionUpdate: "tool_call", toolCallId: "tool", title: "Чтение", status: "in_progress"}, "live", {})
    await f.archive.commit(undefined, [user("u2")])
    await f.archive.receive({sessionUpdate: "tool_call_update", toolCallId: "tool", status: "completed"}, "live", {})
    const before = f.archive.groupPage("service:user:u1").items[0]!
    const after = f.archive.groupPage("service:user:u2").items[0]!
    expect(before.entryId).toBe(after.entryId)
    expect(before.id).not.toBe(after.id)
    expect(before.status).toBe("in_progress")
    expect(after.status).toBe("completed")
    expect(after.requestId).toBe("request1")
    const body = f.archive.groupBody("service:user:u1", before.id).entry
    expect(body.kind === "tool" && body.call.status).toBe("in_progress")
  } finally {await f.close()}
})
test("2000 служебных событий свёрнуты в одну строку; lazy paging и rebuild сохраняют identity", async () => {
  const f = await fixture()
  try {
    await f.archive.commit(undefined, [user("u")])
    for (let offset = 0; offset < 2000; offset += 100) await f.archive.commit(undefined, Array.from({length: 100}, (_, i) => service(`s${offset + i}`)))
    expect(f.archive.display().items).toHaveLength(2)
    expect(f.archive.groupPage("service:user:u").total).toBe(2000)
    let count = 0
    let after: number | undefined
    do {
      const page = f.archive.groupPage("service:user:u", {...(after === undefined ? {} : {after}), limit: 64})
      count += page.items.length
      after = page.after ?? undefined
    } while (after !== undefined)
    expect(count).toBe(2000)
    const previous = f.archive.display()
    await f.archive.dispose()
    await rm(f.archive.cacheFile)
    const rebuilt = await openArchive(join(f.directory, "chat.json"), f.metadata)
    try {expect(rebuilt.display()).toEqual(previous)} finally {await rebuilt.dispose()}
  } finally {await f.close()}
})

test("подтверждённый text replay не создаёт вторую user boundary", async () => {
  const f = await fixture()
  try {
    await f.archive.commit(undefined, [user("user:r"), {type: "append", item: {id: "start", kind: "turn", origin: "local", requestId: "r", state: "started"}}, service("s1")])
    await f.archive.receive({sessionUpdate: "user_message_chunk", messageId: "native-user", content: {type: "text", text: "user:r"}}, "replay", {})
    await f.archive.commit(undefined, [service("s2")])
    expect(f.archive.display().items.filter(item => item.kind === "message").map(item => item.id)).toEqual(["user:r"])
    expect(f.archive.display().items.filter(item => item.kind === "group")).toHaveLength(1)
  } finally {await f.close()}
})

test("большой ответ выдаёт первую ограниченную порцию, Unicode cursor не теряет символы", async () => {
  const f = await fixture()
  try {
    const text = "Русский🙂\n".repeat(60000)
    await f.archive.commit(undefined, [{type: "append", item: {id: "answer", kind: "message", role: "assistant", origin: "live", content: [{type: "text", text}]}}])
    expect(f.archive.body("answer").continuation).toBeDefined()
    let cursor: {block: number; offset: number} | undefined
    let result = ""
    do {
      const page = f.archive.contentPage("answer", {...(cursor === undefined ? {} : {cursor}), maxBytes: 512 * 1024})
      expect(page.bytes).toBeLessThanOrEqual(512 * 1024)
      result += page.content.map(block => block.type === "text" ? block.text : "").join("")
      cursor = page.next ?? undefined
    } while (cursor !== undefined)
    expect(result).toBe(text)
  } finally {await f.close()}
})

test("epoch пользовательских границ отвергает устаревший cursor; streaming группы epoch сохраняет", async () => {
  const f = await fixture()
  try {
    await f.archive.commit(undefined, [user("u1"), service("s1")])
    const epoch = f.archive.display().projectionRevision
    await f.archive.commit(undefined, [service("s2")])
    expect(f.archive.display({projectionRevision: epoch}).projectionRevision).toBe(epoch)
    await f.archive.commit(undefined, [user("u2")])
    expect(() => f.archive.display({projectionRevision: epoch})).toThrow("Проекция истории изменилась")
  } finally {await f.close()}
})

test("detail fragment относится к точному evidence, не к последнему tool aggregate", async () => {
  const f = await fixture()
  try {
    await f.archive.commit(undefined, [user("u1")])
    await f.archive.receive({sessionUpdate: "tool_call", toolCallId: "tool", title: "Чтение", rawOutput: "first"}, "live", {})
    const occurrence = f.archive.groupPage("service:user:u1").items[0]!
    await f.archive.receive({sessionUpdate: "tool_call_update", toolCallId: "tool", rawOutput: "second"}, "live", {})
    const page = f.archive.detailPage(occurrence.entryId, {evidenceId: occurrence.evidenceId!})
    expect(page.text).toContain('"rawOutput":"first"')
    expect(page.text).not.toContain('"rawOutput":"second"')
    expect(() => f.archive.detailPage("u1", {evidenceId: occurrence.evidenceId!})).toThrow("не найдено у записи")
  } finally {await f.close()}
})
