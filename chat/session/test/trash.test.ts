import {afterEach, expect, test} from "bun:test"
import {mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile} from "node:fs/promises"
import {dirname, join} from "node:path"
import {tmpdir} from "node:os"
import {openArchive} from "../src/archive"
import {purgeTrash, readTrash, restoreTrash, softDelete} from "../src/trash"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {for (const close of cleanups.splice(0).reverse()) await close()})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chat-trash-"))
  cleanups.push(() => rm(root, {recursive: true, force: true}))
  const file = join(root, "meta/chat", "conversation.json")
  const metadata = {id: "session", executorId: "agent", executorLabel: "Агент", address: "/", sessionLabel: "Важная беседа",
    sessionId: "provider-identity", pending: [], historyComplete: true, status: "idle" as const, error: null}
  const archive = await openArchive(file, metadata)
  await archive.commit(metadata, [{type: "append", item: {id: "message", origin: "local", kind: "message", role: "user", content: [{type: "text", text: "Сохрани меня"}]}}])
  const header = archive.sourceHeader()
  const cacheFile = archive.cacheFile
  await archive.dispose()
  const journal = join(dirname(file), header.journal)
  const input = {file, sessionId: metadata.id}
  return {root, file, journal, cacheFile, input, metadata}
}

test("soft-delete сохраняет source bytes/provider identity; restore и повтор операций безопасны", async () => {
  const f = await fixture()
  const before = await Promise.all([readFile(f.file), readFile(f.journal)])
  const record = await softDelete(f.input)
  expect(record.metadata.sessionId).toBe("provider-identity")
  expect(await softDelete(f.input)).toEqual(record)
  expect(await readFile(f.file)).toEqual(before[0])
  expect(await readFile(f.journal)).toEqual(before[1])
  expect(await readTrash(f.file)).toEqual(record)
  expect(await restoreTrash(f.input)).toEqual(f.metadata)
  expect(await readTrash(f.file)).toBeNull()
  expect(await restoreTrash(f.input)).toEqual(f.metadata)
  const reopened = await openArchive(f.file, f.metadata)
  try {expect(reopened.content("message")).toEqual([{type: "text", text: "Сохрани меня"}])}
  finally {await reopened.dispose()}
})

test("purge удаляет только точные source/cache файлы; shared media и похожие имена сохраняются", async () => {
  const f = await fixture()
  const neighbour = `${f.file}.journal.unrelated.ndjson`
  const media = join(f.root, "meta/chat/media/shared.png")
  await mkdir(dirname(media), {recursive: true})
  await writeFile(media, "shared")
  await writeFile(neighbour, "unrelated")
  await writeFile(`${f.file}.schema1`, "legacy")
  await softDelete(f.input)
  await purgeTrash({...f.input, cacheFile: f.cacheFile})
  await expect(readFile(f.file)).rejects.toThrow()
  await expect(readFile(f.journal)).rejects.toThrow()
  await expect(readFile(f.cacheFile)).rejects.toThrow()
  await expect(readFile(`${f.file}.schema1`)).rejects.toThrow()
  expect(await readFile(media, "utf8")).toBe("shared")
  expect(await readFile(neighbour, "utf8")).toBe("unrelated")
  expect((await readTrash(f.file))?.purgedAt).toBeDefined()
  await expect(restoreTrash(f.input)).rejects.toThrow("без возможности восстановления")
  await purgeTrash(f.input)
})

test("purge требует hidden identity и отклоняет подменённый журнал/symlink до удаления", async () => {
  const f = await fixture()
  await expect(purgeTrash(f.input)).rejects.toThrow("точную удалённую")
  await softDelete(f.input)
  await expect(restoreTrash({...f.input, sessionId: "other"})).rejects.toThrow("другая сессия")
  await expect(purgeTrash({...f.input, sessionId: "other"})).rejects.toThrow("точную удалённую")
  const bytes = await readFile(f.journal)
  await unlink(f.journal)
  await symlink(f.file, f.journal)
  await expect(purgeTrash(f.input)).rejects.toThrow("обычный файл")
  expect(await readFile(f.file)).not.toHaveLength(0)
  expect((await readTrash(f.file))?.purging).toBeUndefined()
  await unlink(f.journal)
  await writeFile(f.journal, bytes)
  const record = await readTrash(f.file)
  await writeFile(`${f.file}.deleted`, JSON.stringify({...record, journal: "../outside.ndjson"}))
  await expect(purgeTrash(f.input)).rejects.toThrow("не принадлежит")
  expect(await readFile(f.journal)).toEqual(bytes)
})

test("повтор purge завершает прерванную операцию, restore не открывает частично удалённый source", async () => {
  const f = await fixture()
  const record = await softDelete(f.input)
  await writeFile(`${f.file}.deleted`, JSON.stringify({...record, purging: true}))
  await unlink(f.file)
  await expect(restoreTrash(f.input)).rejects.toThrow("без возможности восстановления")
  await purgeTrash(f.input)
  await expect(readFile(f.journal)).rejects.toThrow()
  expect((await readTrash(f.file))?.purgedAt).toBeDefined()
})

test("restore отвергает неполный журнал, не снимая tombstone", async () => {
  const f = await fixture()
  await softDelete(f.input)
  await writeFile(f.journal, "")
  await expect(restoreTrash(f.input)).rejects.toThrow("неполон")
  expect(await readTrash(f.file)).not.toBeNull()
})
