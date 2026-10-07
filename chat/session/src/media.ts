/** Бинарные оригиналы владельца: hash identity, атомарная запись и обратимое ACP-представление. */
import {createHash, randomUUID} from "node:crypto"
import {lstat, mkdir, open, readFile, link, unlink} from "node:fs/promises"
import {join} from "node:path"

export type MediaReference = Readonly<{digest: string, bytes: number, mimeType: string, name?: string}>
/** encoding определяет wire-поле: отсутствие означает base64, utf8 восстанавливает exact resource.text. */
export type StoredBinary = Readonly<{$chatMedia: MediaReference, encoding?: "utf8"}>
export type StoredMediaText = Readonly<{$chatText: readonly (string | StoredBinary)[]}>
export type MediaStore = ReturnType<typeof createMediaStore>
const META = "storybook/media"
type NormalizationScope = "payload" | "content" | "update" | "mutations" | "mutation" | "history" | "evidence"
const contentScopes: Partial<Record<NormalizationScope, Readonly<Record<string, NormalizationScope>>>> = {
  mutation: {item: "history"},
  history: {content: "content", call: "update", update: "update", updates: "evidence"},
  evidence: {update: "update"},
  update: {content: "content", rawInput: "payload", rawOutput: "payload"},
  content: {content: "content", resource: "content", text: "payload", oldText: "payload", newText: "payload"},
}
function storedContent(value: unknown): Record<string, unknown> | null {
  if (!record(value) || value.type !== "resource_link" || !record(value._meta)) return null
  const metadata = value._meta[META]
  return record(metadata) && isMediaReference(metadata.reference) && record(metadata.original) ? metadata.original : null
}
const MAX_BYTES = 16 * 1024 * 1024
const MAX_MATERIALIZED_BYTES = 32 * 1024 * 1024
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")
function resourceName(uri: string): string {
  const name = uri.split("/").at(-1) ?? "Вложение"
  try {return decodeURIComponent(name).slice(0, 512) || "Вложение"} catch {return name.slice(0, 512) || "Вложение"}
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)

export function isMediaReference(value: unknown): value is MediaReference {
  return record(value) && typeof value.digest === "string" && /^[a-f0-9]{64}$/u.test(value.digest) &&
    Number.isSafeInteger(value.bytes) && Number(value.bytes) >= 0 && Number(value.bytes) <= MAX_BYTES &&
    typeof value.mimeType === "string" && value.mimeType.length > 0 && value.mimeType.length <= 256 &&
    (value.name === undefined || typeof value.name === "string" && value.name.length <= 512)
}
export function isStoredBinary(value: unknown): value is StoredBinary {
  return record(value) && Object.keys(value).every(key => key === "$chatMedia" || key === "encoding") &&
    isMediaReference(value.$chatMedia) && (value.encoding === undefined || value.encoding === "utf8")
}
export function isStoredMediaText(value: unknown): value is StoredMediaText {
  return record(value) && Object.keys(value).length === 1 && Array.isArray(value.$chatText) &&
    value.$chatText.every(part => typeof part === "string" || isStoredBinary(part))
}

/** Обходит только descriptors; чтение истории не загружает оригинальные байты. */
export function mediaReferences(value: unknown): readonly MediaReference[] {
  const found = new Map<string, MediaReference>()
  const visit = (entry: unknown): void => {
    if (isStoredBinary(entry)) {found.set(entry.$chatMedia.digest, entry.$chatMedia); return}
    if (Array.isArray(entry)) for (const child of entry) visit(child)
    else if (record(entry)) for (const child of Object.values(entry)) visit(child)
  }
  visit(value)
  return [...found.values()]
}

/** directory — доверенный meta/chat конкретного владельца; путь не приходит из HTTP. */
export function createMediaStore(directory: string) {
  const objects = join(directory, "media")
  const check = (signal?: AbortSignal): void => {signal?.throwIfAborted()}
  const path = (ref: MediaReference): string => {
    if (!isMediaReference(ref)) throw new TypeError("Недопустимая ссылка на медиа")
    return join(objects, ref.digest)
  }
  const read = async (ref: MediaReference, signal?: AbortSignal): Promise<Uint8Array> => {
    check(signal)
    const file = path(ref)
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== ref.bytes) throw new Error("Оригинал медиа повреждён или недоступен")
    const bytes = await readFile(file, signal ? {signal} : {})
    if (digest(bytes) !== ref.digest) throw new Error("Нарушена целостность оригинала медиа")
    check(signal)
    return bytes
  }
  const readObject = async (identity: string, signal?: AbortSignal): Promise<Uint8Array> => {
    if (!/^[a-f0-9]{64}$/u.test(identity)) throw new TypeError("Недопустимая identity медиа")
    const info = await lstat(join(objects, identity))
    return await read({digest: identity, bytes: info.size, mimeType: "application/octet-stream"}, signal)
  }
  const put = async (bytes: Uint8Array, metadata: Readonly<{mimeType: string, name?: string}>, signal?: AbortSignal): Promise<MediaReference> => {
    check(signal)
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BYTES) throw new Error("Оригинал ограничен 16 МиБ")
    const ref = {digest: digest(bytes), bytes: bytes.byteLength, ...metadata}
    if (!isMediaReference(ref)) throw new TypeError("Недопустимые сведения медиа")
    await mkdir(objects, {recursive: true})
    // Не следуем подменённым каталогам хранилища.
    for (const folder of [objects]) {
      const info = await lstat(folder)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Хранилище медиа не может быть ссылкой")
    }
    const temporary = join(objects, `.${randomUUID()}.tmp`)
    const handle = await open(temporary, "wx", 0o600)
    try {
      try {
        await handle.writeFile(bytes)
        await handle.sync()
      } finally {await handle.close()}
      check(signal)
      try {await link(temporary, path(ref))} catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        await read(ref, signal)
      }
      const folder = await open(objects, "r")
      try {await folder.sync()} finally {await folder.close()}
      return Object.freeze(ref)
    } finally {await unlink(temporary).catch(() => {})}
  }
  const binary = async (text: string, mimeType: string, name?: string, signal?: AbortSignal): Promise<StoredBinary> => {
    if (text.length > Math.ceil(MAX_BYTES / 3) * 4) throw new Error("Оригинал медиа ограничен 16 МиБ")
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(text)) {
      throw new Error("Медиа содержит некорректный base64")
    }
    const bytes = Buffer.from(text, "base64")
    if (bytes.toString("base64") !== text) throw new Error("Неканонический base64 не может быть сохранён без потерь")
    return {$chatMedia: await put(bytes, {mimeType, ...(name === undefined ? {} : {name})}, signal)}
  }
  /** Текст остаётся текстом: externalization меняет хранение, не вид content block. */
  const text = async (source: string, signal?: AbortSignal): Promise<string | StoredMediaText> => {
    if (!source.includes("data:image/")) return source
    const expression = /data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})(?=[\s)\]"'<>]|$)/gu
    const parts: (string | StoredBinary)[] = []
    let offset = 0
    for (const match of source.matchAll(expression)) {
      const start = match.index!
      try {
        const saved = await binary(match[2]!, match[1]!, undefined, signal)
        parts.push(source.slice(offset, start), `data:${match[1]};base64,`, saved)
      } catch (error) {
        // Незнакомый/неканонический URI остаётся точным исходным текстом.
        if (signal?.aborted) throw error
        if (!(error instanceof Error) || !error.message.includes("base64")) throw error
        continue
      }
      offset = start + match[0].length
    }
    return parts.length ? {$chatText: [...parts, source.slice(offset)]} : source
  }
  /** Protocol scalars сохраняют тип; произвольные данные обходятся только внутри payload. */
  const normalize = async (value: unknown, signal?: AbortSignal, scope: "content" | "update" | "mutations" | "payload" = "content"): Promise<unknown> => {
    const visit = async (entry: unknown, depth: number, current: NormalizationScope): Promise<unknown> => {
      check(signal)
      if (depth > 128) throw new Error("Слишком глубокий payload медиа")
      if (isStoredBinary(entry) || isStoredMediaText(entry) || storedContent(entry)) return entry
      if (typeof entry === "string") return current === "payload" ? await text(entry, signal) : entry
      if (Array.isArray(entry)) {
        const result: unknown[] = []
        for (const child of entry) result.push(await visit(child, depth + 1, current === "mutations" ? "mutation" : current))
        return result
      }
      if (!record(entry)) return entry
      const result: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(entry)) {
        const mimeType = typeof entry.mimeType === "string" ? entry.mimeType : "application/octet-stream"
        if (current === "content" && typeof child === "string" && (key === "data" && ["image", "audio"].includes(String(entry.type)) || key === "blob" && typeof entry.uri === "string")) {
          result[key] = await binary(child, mimeType, typeof entry.name === "string" ? entry.name : undefined, signal)
        } else {
          const next = current === "payload" ? "payload" : contentScopes[current]?.[key]
          result[key] = next === undefined ? child : await visit(child, depth + 1, next)
        }
      }
      const media = current !== "content" ? null : (entry.type === "image" || entry.type === "audio") && isStoredBinary(result.data) ? result.data.$chatMedia
        : entry.type === "resource" && record(result.resource) && isStoredBinary(result.resource.blob) ? result.resource.blob.$chatMedia : null
      if (media) {
        const originalName = typeof entry.name === "string" ? entry.name : entry.type === "resource" && record(entry.resource) && typeof entry.resource.uri === "string" ? resourceName(entry.resource.uri) : entry.type === "image" ? "Изображение" : "Аудио"
        return {type: "resource_link", uri: `chat-media:${media.digest}`, name: originalName, mimeType: media.mimeType, size: media.bytes,
          _meta: {[META]: {reference: {...media, name: originalName}, original: result}}}
      }
      return result
    }
    return await visit(value, 0, scope)
  }
  const materialize = async (value: unknown, signal?: AbortSignal): Promise<unknown> => {
    let loaded = 0
    const visit = async (entry: unknown, depth: number): Promise<unknown> => {
      check(signal)
      if (depth > 128) throw new Error("Слишком глубокий payload медиа")
      const original = storedContent(entry)
      if (original) return await visit(original, depth + 1)
      if (isStoredBinary(entry)) {
        loaded += entry.$chatMedia.bytes
        if (loaded > MAX_MATERIALIZED_BYTES) throw new Error("Материализация медиа ограничена 32 МиБ на запрос")
        const bytes = await read(entry.$chatMedia, signal)
        return entry.encoding === "utf8" ? new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(bytes) : Buffer.from(bytes).toString("base64")
      }
      if (record(entry) && "$chatMedia" in entry) throw new TypeError("Некорректная ссылка или кодировка binary original")
      if (isStoredMediaText(entry)) {
        const parts: string[] = []
        for (const part of entry.$chatText) parts.push(typeof part === "string" ? part : String(await visit(part, depth + 1)))
        return parts.join("")
      }
      if (Array.isArray(entry)) {
        const result: unknown[] = []
        for (const child of entry) result.push(await visit(child, depth + 1))
        return result
      }
      if (!record(entry)) return entry
      const result: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(entry)) result[key] = await visit(child, depth + 1)
      return result
    }
    return await visit(value, 0)
  }
  return {put, read, readObject, normalize, materialize, project: projectMedia, references: mediaReferences}
}

/** Проекция для проверки/показа: ни один original не читается; wire echo становится короткой подписью. */
export function projectMedia(value: unknown): unknown {
  if (isStoredBinary(value)) return ""
  if (isStoredMediaText(value)) return value.$chatText.map(part => typeof part === "string" ? part : `[медиа ${part.$chatMedia.digest}]`).join("")
    .replace(/data:image\/[A-Za-z0-9.+-]+;base64,\[медиа ([a-f0-9]{64})\]/gu, "/__chat_media/$1")
  if (Array.isArray(value)) return value.map(projectMedia)
  if (!record(value)) return value
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) output[key] = key === "_meta" && storedContent(value) ? child : projectMedia(child)
  return output
}
