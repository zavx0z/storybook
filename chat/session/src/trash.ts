import {createHash, randomUUID} from "node:crypto"
import {constants} from "node:fs"
import {link, lstat, open, readFile, rename, unlink} from "node:fs/promises"
import {basename, dirname, isAbsolute, join, resolve} from "node:path"
import type {ArchiveMetadata} from "./archive"

/** Отметка скрывает беседу, сохраняя исходный header и журнал для восстановления. */
export type TrashRecord = Readonly<{
  schemaVersion: 1
  metadata: ArchiveMetadata
  deletedAt?: string
  journal?: string
  /** После начала физического удаления восстановление уже не обещается. */
  purging?: boolean
  purgedAt?: string
}>

type Identity = Readonly<{file: string, sessionId: string}>
type Header = {schemaVersion: 3, metadata: ArchiveMetadata, journal: string, committedBytes: number}
const operations = new Map<string, Promise<void>>()

/** Только операции одного точного файла сериализуются; чужие беседы не блокируются. */
function exclusive<T>(file: string, run: () => Promise<T>): Promise<T> {
  const key = resolve(file)
  const result = (operations.get(key) ?? Promise.resolve()).then(run, run)
  const settled = result.then(() => {}, () => {})
  operations.set(key, settled)
  void settled.then(() => {if (operations.get(key) === settled) operations.delete(key)})
  return result
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT"

async function regular(path: string, optional = false): Promise<boolean> {
  const info = await lstat(path).catch(error => {if (optional && missing(error)) return null; throw error})
  if (info === null) return false
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Удаление чата принимает только точный обычный файл")
  return true
}

function pathIdentity({file, sessionId}: Identity): void {
  if (!isAbsolute(file) || !file.endsWith(".json") || typeof sessionId !== "string" || !sessionId.trim()) throw new TypeError("Нужны точный header чата и identity сессии")
}

function journalName(file: string, journal: unknown): string {
  if (typeof journal !== "string" || basename(journal) !== journal ||
    !journal.startsWith(`${basename(file)}.journal.`) || !journal.endsWith(".ndjson")) throw new Error("Журнал не принадлежит выбранной беседе")
  return journal
}

async function source(input: Identity): Promise<Header> {
  await regular(input.file)
  const header = JSON.parse(await readFile(input.file, "utf8")) as Header
  if (header.schemaVersion !== 3 || header.metadata?.id !== input.sessionId || typeof header.metadata.executorId !== "string" ||
    !Number.isSafeInteger(header.committedBytes) || header.committedBytes < 0) throw new Error("Identity или header выбранной беседы изменились")
  journalName(input.file, header.journal)
  return header
}

async function syncDirectory(file: string): Promise<void> {
  const directory = await open(dirname(file), "r")
  try {await directory.sync()} finally {await directory.close()}
}

async function writeMarker(file: string, record: TrashRecord, create: boolean): Promise<void> {
  const marker = `${file}.deleted`
  const temporary = `${marker}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try {await handle.writeFile(`${JSON.stringify(record)}\n`); await handle.sync()}
    finally {await handle.close()}
    if (create) await link(temporary, marker)
    else await rename(temporary, marker)
    await syncDirectory(file)
  } finally {await unlink(temporary).catch(error => {if (!missing(error)) throw error})}
}

/** Читает tombstone без открытия архива или запуска модели. */
export async function readTrash(file: string): Promise<TrashRecord | null> {
  if (!await regular(`${file}.deleted`, true)) return null
  const record = JSON.parse(await readFile(`${file}.deleted`, "utf8")) as TrashRecord
  if (record?.schemaVersion !== 1 || typeof record.metadata?.id !== "string" || typeof record.metadata.executorId !== "string" ||
    record.purging !== undefined && typeof record.purging !== "boolean" ||
    record.purgedAt !== undefined && typeof record.purgedAt !== "string") throw new Error("Повреждена отметка удаления сессии")
  if (record.journal !== undefined) journalName(file, record.journal)
  return record
}

/**
Скрывает точную неактивную беседу без потери содержимого и provider identity.
Вызывающий владелец сначала завершает writer; повтор того же удаления безопасен.
Общие media assets остаются у владельца корпуса и не удаляются по одной беседе.
*/
export async function softDelete(input: Identity): Promise<TrashRecord> {
  pathIdentity(input)
  return exclusive(input.file, async () => {
    const existing = await readTrash(input.file)
    if (existing !== null) {
      if (existing.metadata.id !== input.sessionId) throw new Error("Удалена другая сессия")
      return existing
    }
    const header = await source(input)
    const record: TrashRecord = {schemaVersion: 1, metadata: header.metadata, journal: header.journal, deletedAt: new Date().toISOString()}
    await writeMarker(input.file, record, true)
    return record
  })
}

/** Возвращает исходную беседу только при сохранённом источнике и точной identity. */
export async function restoreTrash(input: Identity): Promise<ArchiveMetadata> {
  pathIdentity(input)
  return exclusive(input.file, async () => {
    const record = await readTrash(input.file)
    if (record !== null && record.metadata.id !== input.sessionId) throw new Error("Удалена другая сессия")
    if (record?.purging || record?.purgedAt) throw new Error("Беседа удалена без возможности восстановления")
    const header = await source(input)
    if (record?.journal !== undefined && record.journal !== header.journal) throw new Error("Источник удалённой беседы изменился")
    const journal = join(dirname(input.file), header.journal)
    if (header.committedBytes > 0) {
      await regular(journal)
      if ((await lstat(journal)).size < header.committedBytes) throw new Error("Журнал удалённой беседы неполон")
    }
    if (record !== null) {
      await unlink(`${input.file}.deleted`)
      await syncDirectory(input.file)
    }
    return structuredClone(header.metadata)
  })
}

/**
Необратимо удаляет только явно выбранный уже скрытый корпус и его derived cache.
Частичный отказ оставляет purging marker: повтор безопасен, restore не выдаёт
частично удалённый корпус за восстановленный. Provider remote и media не меняются.
*/
export async function purgeTrash(input: Identity & Readonly<{cacheFile?: string}>): Promise<void> {
  pathIdentity(input)
  return exclusive(input.file, async () => {
    const record = await readTrash(input.file)
    if (record === null || record.metadata.id !== input.sessionId) throw new Error("Сначала выберите точную удалённую беседу")
    if (record.purgedAt !== undefined) return
    const header = await regular(input.file, true) ? await source(input) : null
    const journal = journalName(input.file, record.journal ?? header?.journal)
    if (header !== null && header.journal !== journal) throw new Error("Источник удалённой беседы изменился")
    const hash = createHash("sha256").update(input.file).digest("hex")
    const cacheFile = input.cacheFile ?? join(dirname(dirname(input.file)), "data/chat", `${hash}.sqlite`)
    if (!isAbsolute(cacheFile) || basename(cacheFile) !== `${hash}.sqlite`) throw new TypeError("Cache не принадлежит выбранной беседе")
    const files = [join(dirname(input.file), journal), input.file, `${input.file}.schema1`, `${input.file}.schema2`,
      cacheFile, `${cacheFile}-wal`, `${cacheFile}-shm`]
    // Проверить весь точный набор до первой необратимой операции, без prefix glob.
    for (const file of files) await regular(file, true)
    const pending = {...record, journal, purging: true}
    await writeMarker(input.file, pending, false)
    for (const file of files) await unlink(file).catch(error => {if (!missing(error)) throw error})
    await writeMarker(input.file, {...pending, purgedAt: new Date().toISOString()}, false)
  })
}
