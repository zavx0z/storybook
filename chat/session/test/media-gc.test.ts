import {expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtemp, mkdir, readFile, readdir, rm, symlink, utimes, writeFile} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {createMediaStore} from "../src/media"
import {collectMedia} from "../src/media-gc"

const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const zero = "0".repeat(64)
async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "media-gc-"))
  try {await run(directory)} finally {await rm(directory, {recursive: true, force: true})}
}
async function journal(directory: string, name: string, session: string, payload: unknown) {
  const transaction = JSON.stringify({schemaVersion: 1, previous: zero, metadata: {id: session}, mutations: [{type: "append", item: payload}]})
  const file = `${name}.json`
  const journal = `${file}.journal.test.ndjson`
  await writeFile(join(directory, journal), `${transaction}\n`)
  await writeFile(join(directory, file), JSON.stringify({schemaVersion: 3, metadata: {id: session}, history: {revision: 1, total: 1, lastSequence: 1}, journal,
    committedBytes: Buffer.byteLength(transaction) + 1, hash: hash(zero + transaction)}))
  return file
}
const exclusive = async <T>(action: () => Promise<T>) => await action()

test("dryRun не удаляет; journals/grants удерживают shared originals, orphan удаляется только под owner lease", () => fixture(async directory => {
  const store = createMediaStore(directory)
  const live = await store.normalize({type: "image", mimeType: "image/png", data: "AQ=="})
  const grant = await store.put(new Uint8Array([2]), {mimeType: "image/png"})
  const orphan = await store.put(new Uint8Array([3]), {mimeType: "image/png"})
  await journal(directory, "a", "session-a", live)
  await journal(directory, "b", "session-b", live)
  const grants = join(directory, "media", "grants", hash("session-a"))
  await mkdir(grants, {recursive: true})
  await writeFile(join(grants, grant.digest), "")
  await utimes(join(directory, "media", orphan.digest), new Date(0), new Date(0))
  const plan = await collectMedia(directory)
  expect(plan.candidates).toEqual([orphan.digest])
  expect(plan.removed).toEqual([])
  expect(plan.referenced).toBe(2)
  await expect(collectMedia(directory, {dryRun: false})).rejects.toThrow("exclusive")
  const result = await collectMedia(directory, {dryRun: false, withExclusiveOwner: exclusive})
  expect(result.removed).toEqual([orphan.digest])
  expect(await store.read(grant)).toEqual(new Uint8Array([2]))
  expect(await store.materialize(live)).toEqual({type: "image", mimeType: "image/png", data: "AQ=="})
}))

test("durable tombstone освобождает только удалённую сессию, её устаревшие grants не удерживают purged media", () => fixture(async directory => {
  const store = createMediaStore(directory)
  const content = await store.normalize({type: "image", mimeType: "image/png", data: "AQ=="})
  const ref = store.references(content)[0]!
  const file = await journal(directory, "purged", "deleted-session", content)
  const grants = join(directory, "media", "grants", hash("deleted-session"))
  await mkdir(grants, {recursive: true})
  await writeFile(join(grants, ref.digest), "")
  await writeFile(join(grants, `url-${"a".repeat(64)}.json`), JSON.stringify(ref))
  await writeFile(join(directory, `${file}.deleted`), JSON.stringify({schemaVersion: 1, metadata: {id: "deleted-session"}}))
  await utimes(join(directory, "media", ref.digest), new Date(0), new Date(0))
  const result = await collectMedia(directory, {dryRun: false, withExclusiveOwner: exclusive})
  expect(result.removed).toEqual([ref.digest])
  expect((await readdir(join(directory, "media"))).includes("grants")).toBe(true)
}))

test("malformed header/journal/grant останавливает весь sweep до первого удаления", () => fixture(async directory => {
  const store = createMediaStore(directory)
  const orphan = await store.put(new Uint8Array([9]), {mimeType: "image/png"})
  await utimes(join(directory, "media", orphan.digest), new Date(0), new Date(0))
  await writeFile(join(directory, "broken.json"), "{invalid")
  await expect(collectMedia(directory, {dryRun: false, withExclusiveOwner: exclusive})).rejects.toThrow()
  expect(await store.read(orphan)).toEqual(new Uint8Array([9]))
  await rm(join(directory, "broken.json"))
  const source = await journal(directory, "live", "s", {text: "message"})
  const header = JSON.parse(await readFile(join(directory, source), "utf8"))
  await writeFile(join(directory, header.journal), "{}\n")
  await expect(collectMedia(directory, {dryRun: false, withExclusiveOwner: exclusive})).rejects.toThrow()
  expect(await store.read(orphan)).toEqual(new Uint8Array([9]))
  await rm(join(directory, source))
  await rm(join(directory, header.journal))
  const grants = join(directory, "media", "grants", hash("s"))
  await mkdir(grants, {recursive: true})
  await writeFile(join(grants, "unexpected"), "")
  await expect(collectMedia(directory, {dryRun: false, withExclusiveOwner: exclusive})).rejects.toThrow("Неизвестный")
  expect(await store.read(orphan)).toEqual(new Uint8Array([9]))
}))

test("recovery journal сохраняет originals; symlink, corrupt digest и отсутствующий original блокируют collection", () => fixture(async directory => {
  const store = createMediaStore(directory)
  const content = await store.normalize({type: "image", mimeType: "image/png", data: "AQ=="})
  const ref = store.references(content)[0]!
  const file = await journal(directory, "recovery", "s", content)
  await rm(join(directory, file))
  await utimes(join(directory, "media", ref.digest), new Date(0), new Date(0))
  expect((await collectMedia(directory)).candidates).toEqual([])
  const fake = "a".repeat(64)
  await symlink(join(directory, "media", ref.digest), join(directory, "media", fake))
  await expect(collectMedia(directory)).rejects.toThrow("недопустимый источник")
  await rm(join(directory, "media", fake))
  await writeFile(join(directory, "media", fake), "wrong content")
  await expect(collectMedia(directory)).rejects.toThrow("целостность")
  await rm(join(directory, "media", fake))
  await rm(join(directory, "media", ref.digest))
  await expect(collectMedia(directory)).rejects.toThrow("отсутствующий")
}))
