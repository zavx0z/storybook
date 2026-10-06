/** Консервативная сборка binary originals по durable journals/grants; по умолчанию только план удаления. */
import {createHash} from "node:crypto"
import {constants, createReadStream} from "node:fs"
import {lstat, open, readdir, unlink} from "node:fs/promises"
import {basename, join} from "node:path"
import {isMediaReference, isStoredBinary, isStoredMediaText} from "./media"

export type MediaCollectionResult = Readonly<{referenced: number, retained: number, candidates: readonly string[], removed: readonly string[], bytes: number}>
export type MediaCollectionOptions = Readonly<{
  dryRun?: boolean
  graceMs?: number
  now?: number
  signal?: AbortSignal
  /** Обязателен для удаления: владелец удерживает этот lease от начала scan до конца sweep, включая все archive/grant writers. */
  withExclusiveOwner?: <T>(action: () => Promise<T>) => Promise<T>
}>
const identity = /^[a-f0-9]{64}$/u
const zeroHash = "0".repeat(64)
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
const signature = (value: Awaited<ReturnType<typeof lstat>>) => `${value.ino}:${value.size}:${value.mtimeMs}:${value.ctimeMs}:${value.mode}`

/** Не запускается автоматически. Без owner-exclusive callback destructive mode отвергается до чтения файлов. */
export async function collectMedia(directory: string, options: MediaCollectionOptions = {}): Promise<MediaCollectionResult> {
  const graceMs = options.graceMs ?? 24 * 60 * 60 * 1000
  const now = options.now ?? Date.now()
  if (!Number.isFinite(graceMs) || graceMs < 0 || !Number.isFinite(now) || now < 0) throw new TypeError("Нужны неотрицательные параметры срока хранения")
  const collect = async (): Promise<MediaCollectionResult> => {
    options.signal?.throwIfAborted()
    const snapshots = new Map<string, string>()
    const refs = new Set<string>()
    const sizes = new Map<string, number>()
    const deletedFiles = new Set<string>()
    const deletedSessions = new Set<string>()
    const liveSessions = new Set<string>()
    const journals = new Set<string>()
    const remember = async (path: string, kind: "file" | "directory") => {
      const info = await lstat(path)
      if (info.isSymbolicLink() || (kind === "file" ? !info.isFile() : !info.isDirectory())) throw new Error(`Сборка медиа остановлена: недопустимый источник ${basename(path)}`)
      snapshots.set(path, signature(info))
      return info
    }
    const readJson = async (path: string, maximum = 1024 * 1024): Promise<unknown> => {
      options.signal?.throwIfAborted()
      const info = await remember(path, "file")
      if (info.size > maximum) throw new Error("Источник сборки медиа превышает допустимый размер")
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {return JSON.parse(await handle.readFile("utf8"))} finally {await handle.close()}
    }
    const references = (value: unknown, depth = 0): void => {
      if (depth > 128) throw new Error("Повреждён источник медиа: слишком глубокая структура")
      if (isStoredBinary(value)) {
        const ref = value.$chatMedia
        if (sizes.has(ref.digest) && sizes.get(ref.digest) !== ref.bytes) throw new Error("Размер одного media identity противоречит источникам")
        refs.add(ref.digest)
        sizes.set(ref.digest, ref.bytes)
        return
      }
      if (Array.isArray(value)) {for (const item of value) references(item, depth + 1); return}
      if (!record(value)) return
      if ("$chatMedia" in value || "$chatText" in value && !isStoredMediaText(value)) throw new Error("Повреждена ссылка на binary original")
      if ("uri" in value && typeof value.uri === "string" && value.uri.startsWith("chat-media:")) {
        const digest = value.uri.slice(11)
        if (!identity.test(digest)) throw new Error("Повреждена identity оригинала")
        refs.add(digest)
      }
      for (const child of Object.values(value)) references(child, depth + 1)
      if (refs.size > 100_000) throw new Error("Слишком много объектов для одной сборки медиа")
    }
    const scanJournal = async (path: string, expected?: {bytes: number, hash: string, revision: number}): Promise<void> => {
      const info = await remember(path, "file")
      if (expected && info.size !== expected.bytes) throw new Error("Сначала восстановите неполный или неподтверждённый журнал")
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      let previous = zeroHash
      let revision = 0
      let total = 0
      let pending = ""
      try {
        if (info.size) {
          const decoder = new TextDecoder("utf-8", {fatal: true})
          const stream = createReadStream(path, {fd: handle.fd, autoClose: false, ...(options.signal ? {signal: options.signal} : {})})
          for await (const chunk of stream) {
            options.signal?.throwIfAborted()
            pending += decoder.decode(chunk, {stream: true})
            let end: number
            while ((end = pending.indexOf("\n")) !== -1) {
              const line = pending.slice(0, end)
              pending = pending.slice(end + 1)
              if (Buffer.byteLength(line) > 64 * 1024 * 1024) throw new Error("Слишком большая запись журнала")
              const transaction: unknown = JSON.parse(line)
              if (!record(transaction) || transaction.schemaVersion !== 1 || transaction.previous !== previous || !record(transaction.metadata) || !Array.isArray(transaction.mutations) ||
                !transaction.mutations.every(item => record(item) && ["append", "create", "update", "remove", "purpose"].includes(String(item.type)))) throw new Error("Повреждена цепочка журнала: сборка отменена")
              references(transaction)
              total += Buffer.byteLength(line) + 1
              previous = hash(previous + line)
              revision++
            }
            if (Buffer.byteLength(pending) > 64 * 1024 * 1024) throw new Error("Слишком большая запись журнала")
          }
          pending += decoder.decode()
        }
      } finally {await handle.close()}
      if (pending || total !== info.size || expected && (previous !== expected.hash || revision !== expected.revision)) throw new Error("Журнал не совпадает с durable header: сборка отменена")
      journals.add(basename(path))
    }

    await remember(directory, "directory")
    const entries = await readdir(directory, {withFileTypes: true})
    if (entries.length > 100_000) throw new Error("Слишком много источников в каталоге владельца")
    for (const entry of entries.filter(item => item.name.endsWith(".json.deleted"))) {
      const value = await readJson(join(directory, entry.name))
      if (!record(value) || value.schemaVersion !== 1 || !record(value.metadata) || typeof value.metadata.id !== "string" || !value.metadata.id) throw new Error("Повреждён tombstone беседы")
      deletedFiles.add(entry.name.slice(0, -8))
      deletedSessions.add(hash(value.metadata.id))
    }
    for (const entry of entries.filter(item => item.name.endsWith(".json"))) {
      if (deletedFiles.has(entry.name)) continue
      const value = await readJson(join(directory, entry.name))
      if (!record(value) || value.schemaVersion !== 3 || !record(value.metadata) || typeof value.metadata.id !== "string" ||
        typeof value.journal !== "string" || basename(value.journal) !== value.journal || !value.journal.startsWith(`${entry.name}.journal.`) ||
        !Number.isSafeInteger(value.committedBytes) || Number(value.committedBytes) < 0 || typeof value.hash !== "string" || !identity.test(value.hash) ||
        !record(value.history) || !Number.isSafeInteger(value.history.revision) || Number(value.history.revision) < 0) throw new Error("Неизвестный или повреждённый header: сборка медиа отменена")
      liveSessions.add(hash(value.metadata.id))
      references(value)
      await scanJournal(join(directory, value.journal), {bytes: Number(value.committedBytes), hash: value.hash, revision: Number(value.history.revision)})
    }
    // Неопубликованный, но целый journal сохраняется как recovery root. Не угадываем, что он ненужен.
    for (const entry of entries.filter(item => item.name.includes(".json.journal.") && item.name.endsWith(".ndjson"))) {
      const owner = entry.name.slice(0, entry.name.indexOf(".json.journal.") + 5)
      if (!journals.has(entry.name) && !deletedFiles.has(owner)) await scanJournal(join(directory, entry.name))
    }
    // Legacy backups не удаляются; их references тоже считаются корнями до явного удаления backup.
    for (const entry of entries.filter(item => /\.json\.schema\d+$/u.test(item.name))) {
      const owner = entry.name.slice(0, entry.name.lastIndexOf(".schema"))
      if (!deletedFiles.has(owner)) references(await readJson(join(directory, entry.name), 64 * 1024 * 1024))
    }
    const media = join(directory, "media")
    let objects
    try {await remember(media, "directory"); objects = await readdir(media, {withFileTypes: true})} catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && refs.size === 0) return {referenced: 0, retained: 0, candidates: [], removed: [], bytes: 0}
      throw error
    }
    const grants = join(media, "grants")
    if (objects.some(entry => entry.name === "grants")) {
      await remember(grants, "directory")
      for (const session of await readdir(grants, {withFileTypes: true})) {
        if (!identity.test(session.name)) throw new Error("Неизвестная identity grant: сборка отменена")
        const root = join(grants, session.name)
        await remember(root, "directory")
        const removed = deletedSessions.has(session.name) && !liveSessions.has(session.name)
        for (const entry of await readdir(root, {withFileTypes: true})) {
          if (entry.name.startsWith(".") && entry.name.endsWith(".tmp")) continue
          const path = join(root, entry.name)
          if (identity.test(entry.name)) {
            const info = await remember(path, "file")
            if (info.size !== 0) throw new Error("Повреждён grant оригинала")
            if (!removed) refs.add(entry.name)
          } else if (/^url-[a-f0-9]{64}\.json$/u.test(entry.name)) {
            const value = await readJson(path, 4096)
            if (!isMediaReference(value)) throw new Error("Повреждён индекс external media")
            if (!removed) {
              if (sizes.has(value.digest) && sizes.get(value.digest) !== value.bytes) throw new Error("Противоречивый размер external media")
              refs.add(value.digest)
              sizes.set(value.digest, value.bytes)
            }
          } else throw new Error("Неизвестный source в grants: сборка отменена")
        }
      }
    }
    const candidates: string[] = []
    let bytes = 0
    let retained = 0
    const seen = new Set<string>()
    for (const entry of objects) {
      if (entry.name === "grants" || entry.name.startsWith(".") && entry.name.endsWith(".tmp")) continue
      if (!identity.test(entry.name)) throw new Error("Неизвестный файл в binary store: сборка отменена")
      const path = join(media, entry.name)
      const info = await remember(path, "file")
      if (info.size > 16 * 1024 * 1024 || sizes.has(entry.name) && sizes.get(entry.name) !== info.size) throw new Error("Повреждён размер binary original")
      const original = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const contentHash = createHash("sha256")
        for await (const chunk of createReadStream(path, {fd: original.fd, autoClose: false, ...(options.signal ? {signal: options.signal} : {})})) contentHash.update(chunk)
        if (contentHash.digest("hex") !== entry.name) throw new Error("Повреждена целостность binary original: сборка отменена")
      } finally {await original.close()}
      seen.add(entry.name)
      if (refs.has(entry.name) || info.mtimeMs > now - graceMs) retained++
      else {candidates.push(entry.name); bytes += info.size}
    }
    if ([...refs].some(ref => !seen.has(ref))) throw new Error("Durable source ссылается на отсутствующий original: сборка отменена")
    const verify = async () => {
      options.signal?.throwIfAborted()
      for (const [path, expected] of snapshots) if (signature(await lstat(path)) !== expected) throw new Error("Источник изменился во время сборки: удаление отменено")
    }
    await verify()
    const removed: string[] = []
    if (options.dryRun === false) {
      for (const name of candidates) {
        await verify()
        const path = join(media, name)
        await unlink(path)
        snapshots.delete(path)
        snapshots.set(media, signature(await lstat(media)))
        removed.push(name)
      }
      const folder = await open(media, "r")
      try {await folder.sync()} finally {await folder.close()}
    }
    return {referenced: refs.size, retained, candidates, removed, bytes}
  }
  if (options.dryRun !== false) return await collect()
  if (!options.withExclusiveOwner) throw new Error("Удаление originals требует exclusive lease владельца; используйте dryRun")
  return await options.withExclusiveOwner(collect)
}
