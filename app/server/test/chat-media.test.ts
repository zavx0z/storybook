import {expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile, unlink} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {chatMediaRequest} from "../src/chat-media"
import {createMediaStore} from "../../../chat/session/src/media"

const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const signal = () => new AbortController().signal
async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "chat-media-http-"))
  try {await run(directory)} finally {await rm(directory, {recursive: true, force: true})}
}
function request(directory: string, sessionId: string, operation: "media-put" | "media-read" | "media-external", body: Record<string, unknown>, extra: Partial<Parameters<typeof chatMediaRequest>[0]> = {}, deps: Parameters<typeof chatMediaRequest>[1] = {}) {
  return chatMediaRequest({directory, sessionId, operation, body, signal: signal(), hasMedia: async () => false, ...extra}, deps)
}

test("upload сохраняет имя и binary bytes, только авторизованная беседа читает original", () => fixture(async directory => {
  const name = "Схема 50% (final).png"
  const bytes = new Uint8Array([0, 1, 2, 250, 255])
  const data = Buffer.from(bytes).toString("base64")
  const response = await request(directory, "session-a", "media-put", {name, data, mimeType: "image/png", kind: "image"})
  const content = await response.json()
  expect(content.name).toBe(name)
  expect(content._meta["storybook/media"].reference.name).toBe(name)
  expect(JSON.stringify(content)).not.toContain(data)
  const store = createMediaStore(directory)
  const original = await store.materialize(content) as any
  expect(original.data).toBe(data)
  expect(original._meta["storybook/attachment"].name).toBe(name)
  const media = await request(directory, "session-a", "media-read", {uri: content.uri})
  expect([...new Uint8Array(await media.arrayBuffer())]).toEqual([...bytes])
  expect(media.headers.get("content-length")).toBe(String(bytes.length))
  expect(media.headers.get("x-content-type-options")).toBe("nosniff")
  await expect(request(directory, "session-b", "media-read", {uri: content.uri})).rejects.toThrow("недоступно")
  const archived = await request(directory, "session-b", "media-read", {uri: content.uri}, {hasMedia: async digest => content.uri === `chat-media:${digest}`})
  expect(archived.ok).toBe(true)
  const files = await readdir(join(directory, "media"))
  const object = files.find(value => /^[a-f0-9]{64}$/u.test(value))!
  expect(await readFile(join(directory, "media", object))).toEqual(Buffer.from(bytes))
}))

test("upload отвергает MIME/kind, опасные имена, слишком большой payload и invalid base64 до grant", () => fixture(async directory => {
  for (const body of [
    {name: "../file.png", data: "AQ==", mimeType: "image/png", kind: "image"},
    {name: "a\nb.png", data: "AQ==", mimeType: "image/png", kind: "image"},
    {name: "file.png", data: "AQ==", mimeType: "text/plain", kind: "image"},
    {name: "file.png", data: "AQ==", mimeType: "image/png\r\nX: injected", kind: "image"},
    {name: "file.png", data: "garbage", mimeType: "image/png", kind: "image"},
    {name: "file.png", data: "A".repeat(12 * 1024 * 1024), mimeType: "image/png", kind: "image"},
  ]) await expect(request(directory, "s", "media-put", body)).rejects.toThrow()
  await expect(request(directory, "s", "media-read", {uri: "chat-media:../../outside"}, {hasMedia: async () => true})).rejects.toThrow()
}))

test("external image cache повторно проверяет membership и не загружает ресурс второй раз", () => fixture(async directory => {
  let loads = 0
  const uri = "https://example.com/logo.png"
  const fetchImage = async () => {loads++; return {bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", uri}}
  const responses = await Promise.all([request(directory, "s", "media-external", {uri}, {}, {fetchImage}), request(directory, "s", "media-external", {uri}, {}, {fetchImage})])
  expect(loads).toBe(1)
  for (const response of responses) {
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(response.headers.get("content-length")).toBe("3")
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3])
  }
  const cache = join(directory, "media", "grants", hash("s"))
  const saved = JSON.parse(await readFile(join(cache, `url-${hash(uri)}.json`), "utf8"))
  await unlink(join(cache, saved.digest))
  await expect(request(directory, "s", "media-external", {uri}, {}, {fetchImage})).rejects.toThrow("недоступно")
  expect(loads).toBe(1)
  await request(directory, "s", "media-external", {uri}, {hasMedia: async () => true}, {fetchImage})
  expect(loads).toBe(1)
}))

test("abort и повреждённый cache не превращаются в повторный fetch или успешную выдачу", () => fixture(async directory => {
  const abort = new AbortController()
  abort.abort()
  let calls = 0
  const uri = "https://example.com/logo.png"
  const fetchImage = async () => {calls++; return {bytes: new Uint8Array([1]), mimeType: "image/png", uri}}
  await expect(request(directory, "s", "media-external", {uri}, {signal: abort.signal}, {fetchImage})).rejects.toHaveProperty("name", "AbortError")
  expect(calls).toBe(0)
  await request(directory, "s", "media-external", {uri}, {}, {fetchImage})
  const cache = join(directory, "media", "grants", hash("s"), `url-${hash(uri)}.json`)
  await writeFile(cache, "{broken")
  await expect(request(directory, "s", "media-external", {uri}, {}, {fetchImage})).rejects.toThrow()
  expect(calls).toBe(1)
}))

test("media/grants/cache symlinks не читают и не перезаписывают чужие файлы", () => fixture(async directory => {
  const outside = join(directory, "outside")
  await mkdir(outside)
  await writeFile(join(outside, "victim"), "keep")
  await symlink(outside, join(directory, "media"))
  await expect(request(directory, "s", "media-put", {name: "a.png", data: "AQ==", mimeType: "image/png", kind: "image"})).rejects.toThrow("ссылкой")
  expect(await readFile(join(outside, "victim"), "utf8")).toBe("keep")
  await unlink(join(directory, "media"))
  await mkdir(join(directory, "media", "grants"), {recursive: true})
  await symlink(outside, join(directory, "media", "grants", hash("s")))
  await expect(request(directory, "s", "media-read", {uri: `chat-media:${"a".repeat(64)}`}, {hasMedia: async () => true})).rejects.toThrow("ссылкой")
  await unlink(join(directory, "media", "grants", hash("s")))
  await mkdir(join(directory, "media", "grants", hash("s")))
  const uri = "https://example.com/logo.png"
  await symlink(join(outside, "victim"), join(directory, "media", "grants", hash("s"), `url-${hash(uri)}.json`))
  await expect(request(directory, "s", "media-external", {uri})).rejects.toThrow()
  expect(await readFile(join(outside, "victim"), "utf8")).toBe("keep")
}))

test("отмена ожидающего cache клиента не отменяет первый fetch и не разрешает лишний fetch", () => fixture(async directory => {
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  let calls = 0
  const uri = "https://example.com/slow.png"
  const fetchImage = async () => {calls++; entered.resolve(); await finish.promise; return {bytes: new Uint8Array([1]), mimeType: "image/png", uri}}
  const first = request(directory, "s", "media-external", {uri}, {}, {fetchImage})
  await entered.promise
  const abort = new AbortController()
  const second = request(directory, "s", "media-external", {uri}, {signal: abort.signal}, {fetchImage})
  abort.abort()
  await expect(second).rejects.toHaveProperty("name", "AbortError")
  const third = request(directory, "s", "media-external", {uri}, {}, {fetchImage})
  finish.resolve()
  expect((await first).ok).toBe(true)
  expect((await third).ok).toBe(true)
  expect(calls).toBe(1)
}))

test("abort после внешнего IO не создаёт original/grant и не отвечает success", () => fixture(async directory => {
  const abort = new AbortController()
  const uri = "https://example.com/late.png"
  const fetchImage = async () => {abort.abort(); return {bytes: new Uint8Array([1]), mimeType: "image/png", uri}}
  await expect(request(directory, "s", "media-external", {uri}, {signal: abort.signal}, {fetchImage})).rejects.toHaveProperty("name", "AbortError")
  expect(await readdir(directory)).toEqual([])
}))

test("UTF-8 upload материализует readable resource.text, original Unicode/BOM bytes и SHA сохраняются", () => fixture(async directory => {
  const text = "\uFEFFПривет, мир 🌍\r\n\"данные\"\t漢字\n"
  const bytes = Buffer.from(text, "utf8")
  const response = await request(directory, "s", "media-put", {name: "Заметка.txt", data: bytes.toString("base64"), mimeType: "text/plain", kind: "file", encoding: "utf8"})
  const content = await response.json()
  const store = createMediaStore(directory)
  const original = await store.materialize(content) as {resource: {text: string, blob?: string}}
  expect(original.resource.text).toBe(text)
  expect(original.resource.blob).toBeUndefined()
  expect(content.type).toBe("resource_link")
  expect(JSON.stringify(content)).not.toContain(bytes.toString("base64"))
  expect(store.references(content)).toHaveLength(1)
  const ref = store.references(content)[0]!
  expect(ref.digest).toBe(createHash("sha256").update(bytes).digest("hex"))
  expect(await store.read(ref)).toEqual(bytes)
  expect(await store.materialize(await store.normalize(content))).toEqual(original)
  const download = await request(directory, "s", "media-read", {uri: content.uri})
  expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes)
}))

test("UTF-8 upload отвергает неизвестную encoding, бинарный MIME и невалидные UTF-8 bytes до записи", () => fixture(async directory => {
  for (const extra of [
    {encoding: "latin1"},
    {encoding: "utf8", mimeType: "application/pdf"},
    {encoding: "utf8", kind: "image", mimeType: "image/png"},
    {encoding: "utf8", data: Buffer.from([0xff, 0xfe]).toString("base64")},
  ]) await expect(request(directory, "s", "media-put", {name: "file.txt", data: "AQ==", mimeType: "text/plain", kind: "file", ...extra})).rejects.toThrow()
  expect(await readdir(directory)).toEqual([])
}))

test("media IO не проходит через symlink родительского meta даже при существующем chat", () => fixture(async root => {
  const outside = join(root, "outside")
  await mkdir(join(outside, "chat"), {recursive: true})
  await symlink(outside, join(root, "meta"))
  const directory = join(root, "meta", "chat")
  await expect(request(directory, "s", "media-put", {name: "first.png", data: "AQ==", mimeType: "image/png", kind: "image"})).rejects.toThrow("ссылкой")
  await expect(request(directory, "s", "media-read", {uri: `chat-media:${"a".repeat(64)}`}, {hasMedia: async () => true})).rejects.toThrow("ссылкой")
  expect(await readdir(join(outside, "chat"))).toEqual([])
}))
