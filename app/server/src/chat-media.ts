/** Авторизованный browser IO для оригиналов беседы; публичные docs/assets не используются. */
import {createHash, randomUUID} from "node:crypto"
import {constants} from "node:fs"
import {mkdir, open, lstat, rename, unlink} from "node:fs/promises"
import {dirname, join} from "node:path"
import {createMediaStore, fetchExternalImage, isMediaReference} from "@zavx0z/storybook-chat-session"

const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const digestPattern = /^[a-f0-9]{64}$/u
const mimePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const operations = new Map<string, Promise<void>>()

/** Очередь одного URL: отмена первого клиента не отменяет самостоятельный запрос второго. */
async function serial<T>(key: string, signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  if (!operations.has(key) && operations.size >= 128) throw new Error("Слишком много одновременных загрузок изображений")
  const previous = operations.get(key)
  const ready = Promise.withResolvers<void>()
  operations.set(key, ready.promise)
  let releaseAbort = () => {}
  try {
    if (previous) await Promise.race([previous, new Promise<never>((_, reject) => {
      const aborted = () => reject(signal.reason ?? new DOMException("Отменено", "AbortError"))
      signal.addEventListener("abort", aborted, {once: true})
      releaseAbort = () => signal.removeEventListener("abort", aborted)
      if (signal.aborted) aborted()
    })])
    signal.throwIfAborted()
    return await action()
  } finally {
    releaseAbort()
    const complete = () => {
      ready.resolve()
      if (operations.get(key) === ready.promise) operations.delete(key)
    }
    // Отменённый waiter возвращается сразу, но не пропускает следующего перед active writer.
    if (previous) void previous.then(complete)
    else complete()
  }
}

async function directory(path: string, create: boolean): Promise<boolean> {
  if (create) {
    try {await mkdir(path, {mode: 0o700})} catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
  }
  try {
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Каталог медиа не может быть ссылкой или файлом")
    return true
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

async function smallFile(path: string, maximum: number): Promise<string | null> {
  let handle
  try {handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)} catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maximum) throw new Error("Повреждены сведения доступа к медиа")
    return await handle.readFile("utf8")
  } finally {await handle.close()}
}

function binaryResponse(bytes: Uint8Array, mimeType: string): Response {
  return new Response(new Uint8Array(bytes), {headers: {
    "content-type": mimeType,
    "content-length": String(bytes.byteLength),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  }})
}

export async function chatMediaRequest(input: Readonly<{
  directory: string
  sessionId: string
  operation: "media-put" | "media-read" | "media-external"
  body: Record<string, unknown>
  signal: AbortSignal
  hasMedia(digest: string): Promise<boolean>
}>, dependencies: Readonly<{fetchImage?: typeof fetchExternalImage}> = {}): Promise<Response> {
  input.signal.throwIfAborted()
  if (!input.sessionId || input.sessionId.length > 512) throw new TypeError("Нужна identity беседы")
  // Первое вложение может поступить до первого сообщения и создания журнала.
  // Проверяем оба принадлежащих чату уровня, не переходя через meta/chat symlink.
  const create = input.operation === "media-put"
  if (!await directory(dirname(input.directory), create) || !await directory(input.directory, create)) {
    throw new Error("Каталог беседы не найден")
  }
  const store = createMediaStore(input.directory)
  const media = join(input.directory, "media")
  const grantRoot = join(media, "grants")
  const grants = join(grantRoot, hash(input.sessionId))
  const directories = async (create: boolean): Promise<boolean> => {
    for (const path of [media, grantRoot, grants]) if (!await directory(path, create)) return false
    return true
  }
  const grant = async (digest: string): Promise<void> => {
    input.signal.throwIfAborted()
    await directories(true)
    const file = join(grants, digest)
    let handle
    try {handle = await open(file, "wx", 0o600)} catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      if (await smallFile(file, 0) !== "") throw new Error("Повреждено разрешение медиа")
    }
    if (handle) {
      try {await handle.sync()} finally {await handle.close()}
      const folder = await open(grants, "r")
      try {await folder.sync()} finally {await folder.close()}
    }
    input.signal.throwIfAborted()
  }
  const granted = async (digest: string): Promise<boolean> => {
    if (!await directories(false)) return false
    return await smallFile(join(grants, digest), 0) === ""
  }
  const allowed = async (digest: string): Promise<boolean> => {
    const result = await granted(digest) || await input.hasMedia(digest)
    input.signal.throwIfAborted()
    return result
  }
  if (input.operation === "media-put") {
    const body = input.body
    if (typeof body.data !== "string" || body.data.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 ||
      typeof body.mimeType !== "string" || body.mimeType.length > 128 || !mimePattern.test(body.mimeType) ||
      typeof body.name !== "string" || !body.name || body.name.length > 512 || /[\u0000-\u001f\u007f/\\]/u.test(body.name) ||
      typeof body.kind !== "string" || !["image", "audio", "file"].includes(body.kind) ||
      body.encoding !== undefined && body.encoding !== "utf8" ||
      body.encoding === "utf8" && (body.kind !== "file" || !(body.mimeType.toLowerCase().startsWith("text/") || ["application/json", "application/xml"].includes(body.mimeType.toLowerCase()))) ||
      body.kind === "image" && !body.mimeType.startsWith("image/") || body.kind === "audio" && !body.mimeType.startsWith("audio/")) {
      throw new TypeError("Некорректное вложение")
    }
    // Проверка decoded length до нормализации закрывает округление последнего base64 quartet.
    const decoded = Buffer.from(body.data, "base64")
    if (decoded.byteLength > MAX_UPLOAD_BYTES) throw new Error("Вложение ограничено 8 МиБ")
    if (body.encoding === "utf8") new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(decoded)
    await directory(media, true)
    const metadata = {"storybook/attachment": {name: body.name}}
    const block = body.kind === "file"
      ? {type: "resource", resource: {uri: `attachment:/${encodeURIComponent(body.name)}`, mimeType: body.mimeType, blob: body.data}, _meta: metadata}
      : {type: body.kind, mimeType: body.mimeType, data: body.data, _meta: metadata}
    const content = await store.normalize(block, input.signal) as Record<string, unknown>
    content.name = body.name
    const meta = content._meta as {"storybook/media": {reference: Record<string, unknown>, original: {resource?: {blob?: unknown, text?: unknown}}}}
    meta["storybook/media"].reference.name = body.name
    if (body.encoding === "utf8") {
      const resource = meta["storybook/media"].original.resource!
      resource.text = {...resource.blob as Record<string, unknown>, encoding: "utf8"}
      delete resource.blob
    }
    const references = store.references(content)
    if (references.length !== 1) throw new TypeError("Вложение не содержит оригинал")
    await grant(references[0]!.digest)
    input.signal.throwIfAborted()
    return Response.json(content, {headers: {"cache-control": "no-store"}})
  }
  if (input.operation === "media-read") {
    if (typeof input.body.uri !== "string" || !input.body.uri.startsWith("chat-media:")) throw new TypeError("Нужна ссылка на медиа")
    const digest = input.body.uri.slice("chat-media:".length)
    if (!digestPattern.test(digest) || !await allowed(digest)) throw new Error("Медиа недоступно в выбранной беседе")
    if (!await directory(media, false)) throw new Error("Оригинал медиа не найден")
    const bytes = await store.readObject(digest, input.signal)
    return binaryResponse(bytes, "application/octet-stream")
  }
  if (input.operation !== "media-external" || typeof input.body.uri !== "string" || input.body.uri.length > 4096) throw new TypeError("Нужен адрес изображения")
  const uri = input.body.uri
  const url = new URL(uri)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new TypeError("Нужен публичный адрес изображения")
  return await serial(`${input.directory}\0${input.sessionId}\0${uri}`, input.signal, async () => {
    const remoteIndex = join(grants, `url-${hash(uri)}.json`)
    if (await directories(false)) {
      const encoded = await smallFile(remoteIndex, 4096)
      if (encoded !== null) {
        const saved: unknown = JSON.parse(encoded)
        if (!isMediaReference(saved) || !mimePattern.test(saved.mimeType) || !saved.mimeType.startsWith("image/")) throw new Error("Повреждён индекс внешнего изображения")
        if (!await allowed(saved.digest)) throw new Error("Изображение недоступно в выбранной беседе")
        return binaryResponse(await store.read(saved, input.signal), saved.mimeType)
      }
    }
    const image = await (dependencies.fetchImage ?? fetchExternalImage)(uri, input.signal)
    input.signal.throwIfAborted()
    if (!mimePattern.test(image.mimeType) || !image.mimeType.startsWith("image/") || image.bytes.byteLength > 16 * 1024 * 1024) throw new Error("Некорректное внешнее изображение")
    const ref = await store.put(image.bytes, {mimeType: image.mimeType}, input.signal)
    await grant(ref.digest)
    const temporary = join(grants, `.${randomUUID()}.tmp`)
    const handle = await open(temporary, "wx", 0o600)
    try {
      try {await handle.writeFile(JSON.stringify(ref)); await handle.sync()} finally {await handle.close()}
      input.signal.throwIfAborted()
      await rename(temporary, remoteIndex)
      const folder = await open(grants, "r")
      try {await folder.sync()} finally {await folder.close()}
      input.signal.throwIfAborted()
      return binaryResponse(image.bytes, image.mimeType)
    } finally {await unlink(temporary).catch(() => {})}
  })
}
