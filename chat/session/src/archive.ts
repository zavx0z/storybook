/**
Дисковая история беседы. Текстовый журнал в meta/chat является источником;
SQLite содержит только восстанавливаемую адресацию и проекции. Управляющее
состояние не удерживает записи, payload или полный индекс истории в памяти.
Replay собственного bootstrap с точным canonical user content раскрывается как
context. При повторении одинакового ввода requestId остаётся неопределённым;
provider identity и evidence остаются на диске, а бинарные байты
вынесены в неизменяемые объекты meta/chat/media. SQLite восстанавливает отдельную
проекцию сообщений и служебных групп, не загружая оригиналы вложений.
*/
import {query as cachedQuery} from "./queries"
import {Database} from "bun:sqlite"
import {createHash, randomUUID} from "node:crypto"
import {createReadStream, statSync} from "node:fs"
import {copyFile, link, mkdir, open, readFile, rename, stat, unlink} from "node:fs/promises"
import {basename, dirname, join, resolve} from "node:path"
import type {StorybookChatHistory} from "@zavx0z/storybook-chat-history"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"
import readHistory from "@zavx0z/storybook-chat-history"
import type {HistoryBody, HistoryEntry, HistoryEvidence, HistoryEvidencePage, HistoryPage, HistoryQuery, HistoryState, HistoryDisplayPage, HistoryGroupPage, HistoryGroup, HistoryOccurrence, HistoryContentCursor, HistoryContentPage, HistoryContentQuery, HistoryDetailPage, HistoryTerminalPage, HistoryTerminalQuery} from "../contract/history"
import type {Document} from "./document"
import {createMediaStore, projectMedia, isStoredMediaText, isStoredBinary, mediaReferences} from "./media"
import {prepareProjection, clearProjection, syncDisplayMessage, removeOccurrences, indexOccurrence} from "./history-projection"
import {defaultExecutorId} from "./identity"

type Item = StorybookChatHistory.Output[number]
type Content = Extract<Item, {kind: "message"}>["content"][number]
type Update = Parameters<StorybookTechAcp.Input["onUpdate"]>[0]
type Origin = Item["origin"]
type Tool = Extract<Item, {kind: "tool"}>["call"]
type NewItem = Item extends infer T ? T extends Item ? Omit<T, "sequence"> & {sequence?: number} : never : never

export type ArchiveMetadata = Omit<Document, "schemaVersion" | "timeline">
export type ArchiveCursor = {message?: string; batchId?: string}
export type ArchiveMutation =
  | {type: "append"; item: NewItem}
  | {type: "purpose"; id: string}
  | {type: "remove"; id: string}

type StoredMutation =
  | {type: "append"; item: Item}
  | {type: "create"; entry: Record<string, unknown>; event: HistoryEvidence}
  | {type: "purpose"; id: string}
  | {type: "remove"; id: string}
  | {type: "update"; id: string; event: HistoryEvidence; reset?: boolean; replayBatch?: string}

type Header = {
  schemaVersion: 3
  metadata: ArchiveMetadata
  history: HistoryState
  displayHistory?: HistoryState
  journal: string
  committedBytes: number
  hash: string
}
type Transaction = {schemaVersion: 1; previous: string; metadata: ArchiveMetadata; mutations: StoredMutation[]}
type Row = {id: string; ordinal: number; sequence: number; revision: number; kind: Item["kind"]; origin: Origin; preview: string; data?: string; body_bytes: number; evidence_count: number; provider_id: string | null; tool_id: string | null; replay_batch: string | null}
const SMALL_COLUMNS = "id,ordinal,sequence,revision,kind,origin,preview,body_bytes,evidence_count,provider_id,tool_id,replay_batch"
const BODY_LIMIT = 16 * 1024 * 1024
const CODEX_IMAGE_ECHO = "codex-image-echo-v1"
const CODEX_TEXT_ECHO = "codex-text-echo-v1"
const RECORD_LIMIT = 64 * 1024 * 1024
const QUEUE_LIMIT = 32 * 1024 * 1024
const ZERO_HASH = "0".repeat(64)
const pool = new Map<string, Database>()
const writeLeases = new Map<string, {tail: Promise<void>; waiting: number}>()

/** Lease существует только пока файл действительно имеет writer или ожидающего. */
async function writeLease<T>(file: string, action: () => Promise<T>): Promise<T> {
  const key = resolve(file)
  let lease = writeLeases.get(key)
  if (lease === undefined) {
    if (writeLeases.size >= 64) throw new Error("Одновременно записывается слишком много корпусов истории")
    lease = {tail: Promise.resolve(), waiting: 0}
    writeLeases.set(key, lease)
  }
  if (lease.waiting >= 128) throw new Error("Очередь writer lease заполнена; дождитесь предыдущей записи")
  const previous = lease.tail
  const completion = Promise.withResolvers<void>()
  lease.tail = completion.promise
  lease.waiting += 1
  await previous
  try { return await action() } finally {
    lease.waiting -= 1
    completion.resolve()
    if (lease.waiting === 0 && writeLeases.get(key) === lease) writeLeases.delete(key)
  }
}

function digest(value: string): string { return createHash("sha256").update(value).digest("hex") }
/** Порядок JSON-полей не меняет ContentBlock; порядок блоков, массивов и текст остаются точными. */
function contentEncoding(value: unknown): string {
  return JSON.stringify(value, (_, entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : entry)
}
/** Exact text/image history echo официального Codex ACP; произвольные Markdown links не декодируются. */
function echoText(value: unknown): string {
  return isStoredMediaText(value) ? value.$chatText.map(part => typeof part === "string" ? part : `[sha256:${part.$chatMedia.digest}]`).join("") : String(value)
}
function codexImageEcho(content: readonly Content[]): string | null {
  let image = false
  const parts: string[] = []
  for (const block of content) {
    if (block.type === "text") {parts.push(echoText(block.text)); continue}
    const metadata = block.type === "resource_link" ? block._meta?.["storybook/media"] as {original?: Record<string, unknown>} | undefined : undefined
    const original = metadata?.original
    if (block.type !== "image" && original?.type !== "image") return null
    image = true
    const source = block.type === "image" ? block : original!
    let uri = isStoredBinary(source.data) ? `data:${source.mimeType};base64,[sha256:${source.data.$chatMedia.digest}]` : `data:${source.mimeType};base64,${source.data}`
    if (typeof source.uri === "string") {
      try {if (["http:", "https:", "data:"].includes(new URL(source.uri).protocol)) uri = source.uri} catch {}
    }
    parts.push(`[@image](${uri})`)
  }
  return image ? parts.join("") : null
}
function database(file: string): Database {
  const existing = pool.get(file)
  if (existing !== undefined) { pool.delete(file); pool.set(file, existing); return existing }
  while (pool.size >= 8) {
    const [key, value] = pool.entries().next().value!
    value.close()
    pool.delete(key)
  }
  const db = new Database(file, {create: true})
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-2048; PRAGMA temp_store=FILE;
    CREATE TABLE IF NOT EXISTS stamp (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS entry (id TEXT PRIMARY KEY, ordinal INTEGER UNIQUE NOT NULL, sequence INTEGER NOT NULL,
      revision INTEGER NOT NULL, kind TEXT NOT NULL, origin TEXT NOT NULL, preview TEXT NOT NULL, data TEXT NOT NULL,
      body_bytes INTEGER NOT NULL DEFAULT 0, evidence_count INTEGER NOT NULL DEFAULT 0,
      provider_id TEXT, tool_id TEXT, replay_batch TEXT);
    CREATE INDEX IF NOT EXISTS ordered_entry ON entry(ordinal);
    CREATE INDEX IF NOT EXISTS provider_entry_order ON entry(provider_id,ordinal);
    CREATE INDEX IF NOT EXISTS tool_entry_order ON entry(tool_id,ordinal);
    CREATE INDEX IF NOT EXISTS assistant_entry ON entry(sequence DESC)
      WHERE kind='message' AND json_extract(preview,'$.role')='assistant';
    CREATE INDEX IF NOT EXISTS started_turn ON entry(ordinal DESC,json_extract(data,'$.requestId'))
      WHERE kind='turn' AND json_extract(preview,'$.state')='started';
    CREATE INDEX IF NOT EXISTS started_request ON entry(json_extract(data,'$.requestId'))
      WHERE kind='turn' AND json_extract(preview,'$.state')='started';
    CREATE INDEX IF NOT EXISTS terminal_request ON entry(json_extract(data,'$.requestId'))
      WHERE kind='turn' AND json_extract(preview,'$.state')!='started';
    CREATE INDEX IF NOT EXISTS local_context_request ON entry(json_extract(data,'$.requestId'))
      WHERE kind='context' AND origin='local';
    CREATE TABLE IF NOT EXISTS block (entry_id TEXT NOT NULL, ordinal INTEGER NOT NULL, bytes INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY(entry_id,ordinal));
    CREATE TABLE IF NOT EXISTS evidence (entry_id TEXT NOT NULL, ordinal INTEGER NOT NULL, id TEXT UNIQUE NOT NULL,
      sequence INTEGER NOT NULL, bytes INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(entry_id,ordinal));
    CREATE TABLE IF NOT EXISTS identity (id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, entry_id TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS event_sequence ON identity(sequence) WHERE sequence > 0;
    CREATE INDEX IF NOT EXISTS parent_identity ON identity(entry_id);`)
  const replayIndexSchema = `CREATE TABLE IF NOT EXISTS supplied_input (context_id TEXT NOT NULL, request_id TEXT NOT NULL,
    bootstrap_hash TEXT NOT NULL, input_hash TEXT NOT NULL, PRIMARY KEY(context_id,bootstrap_hash));
    CREATE INDEX IF NOT EXISTS supplied_input_content ON supplied_input(bootstrap_hash,input_hash);
    CREATE INDEX IF NOT EXISTS supplied_input_request ON supplied_input(request_id);
    CREATE INDEX IF NOT EXISTS supplied_context_request ON entry(json_extract(data,'$.requestId')) WHERE kind='context' AND origin='local';
    CREATE TABLE IF NOT EXISTS replay_input (entry_id TEXT NOT NULL, bootstrap_hash TEXT NOT NULL, input_hash TEXT NOT NULL, PRIMARY KEY(entry_id,bootstrap_hash));
    CREATE INDEX IF NOT EXISTS replay_input_content ON replay_input(bootstrap_hash,input_hash);
    CREATE TABLE IF NOT EXISTS replay_projection (entry_id TEXT PRIMARY KEY, context_id TEXT NOT NULL, request_id TEXT, body_bytes INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS replay_projection_context ON replay_projection(context_id);
    CREATE INDEX IF NOT EXISTS replay_projection_request ON replay_projection(request_id);`
  db.exec(replayIndexSchema)
  const replayColumns = cachedQuery(db, "PRAGMA table_info(replay_projection)").all() as {name: string; notnull: number}[]
  if (replayColumns.some(column => column.name === "request_id" && column.notnull === 1)) {
    // Меняется только восстанавливаемый cache; journal и metadata остаются источником.
    db.exec("DROP TABLE replay_projection; DELETE FROM stamp;")
    db.exec(replayIndexSchema)
  }
  const keys = cachedQuery(db, "PRAGMA table_info(supplied_input)").all() as {pk: number}[]
  if (keys.filter(column => column.pk > 0).length === 1) {
    db.exec("DROP TABLE supplied_input; DROP TABLE replay_input; DELETE FROM replay_projection; DELETE FROM stamp;")
    db.exec(replayIndexSchema)
  }
  db.exec("CREATE TABLE IF NOT EXISTS entry_media (entry_id TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(entry_id,digest)); CREATE INDEX IF NOT EXISTS media_digest ON entry_media(digest);")
  db.exec(`CREATE TABLE IF NOT EXISTS terminal_event (entry_id TEXT NOT NULL, evidence_id TEXT PRIMARY KEY,
    ordinal INTEGER NOT NULL, sequence INTEGER NOT NULL, stream TEXT NOT NULL, has_output INTEGER NOT NULL,
    terminal_id TEXT, cwd TEXT, exit_code INTEGER, exit_signal TEXT, has_exit INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS terminal_event_order ON terminal_event(entry_id,ordinal);
    CREATE INDEX IF NOT EXISTS terminal_exit_order ON terminal_event(entry_id,ordinal DESC) WHERE has_exit=1;
    CREATE INDEX IF NOT EXISTS terminal_info_order ON terminal_event(entry_id,ordinal DESC) WHERE cwd IS NOT NULL;`)
  prepareProjection(db)
  pool.set(file, db)
  return db
}
function closeDatabase(file: string): void {
  pool.get(file)?.close()
  pool.delete(file)
}
async function atomicHeader(file: string, header: Header): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(temporary, "wx", 0o600)
  try { await handle.writeFile(`${JSON.stringify(header, null, 2)}\n`); await handle.sync() }
  finally { await handle.close() }
  try {
    await rename(temporary, file)
    const directory = await open(dirname(file), "r")
    try { await directory.sync() } finally { await directory.close() }
  } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error }) }
}
function compactData(item: Item): Record<string, unknown> {
  if (item.kind === "message") { const {content, updates, ...data} = item; return data }
  if (item.kind === "context") { const {content, ...data} = item; return data }
  if (item.kind === "tool") { const {updates, ...data} = item; return data }
  return {...item}
}
function headerEntry(row: Row): HistoryEntry {
  const data = JSON.parse(row.preview)
  return {id: row.id, ordinal: row.ordinal, sequence: row.sequence, revision: row.revision,
    kind: row.kind, origin: row.origin,
    ...(data.role === undefined ? {} : {role: data.role}),
    ...(data.purpose === undefined ? {} : {purpose: data.purpose}),
    ...(data.title === undefined ? {} : {title: data.title}),
    ...(data.eventType === undefined ? {} : {eventType: data.eventType}),
    ...(data.phase === undefined ? {} : {phase: data.phase}),
    ...(data.status === undefined ? {} : {status: data.status}),
    ...(data.state === undefined ? {} : {state: data.state}),
    ...(data.stopReason === undefined ? {} : {stopReason: String(data.stopReason).slice(0, 1024)}),
    ...(data.error === undefined ? {} : {error: String(data.error).slice(0, 1024)}),
    ...(data.receivedAt === undefined ? {} : {receivedAt: data.receivedAt}),
    bodyBytes: row.body_bytes, evidenceCount: row.evidence_count}
}
function preview(item: Record<string, any>): string {
  return JSON.stringify({
    ...(item.receivedAt === undefined ? {} : {receivedAt: item.receivedAt}),
    ...(item.phase === undefined ? {} : {phase: item.phase}),
    ...(item.role === undefined ? {} : {role: item.role}),
    ...(item.purpose === undefined ? {} : {purpose: item.purpose}),
    ...(typeof (item.call?.title ?? item.title) === "string" ? {title: String(item.call?.title ?? item.title).slice(0, 1024)} : {}),
    ...(typeof item.update?.sessionUpdate === "string" ? {eventType: item.update.sessionUpdate} : {}),
    ...(typeof item.call?.status === "string" ? {status: item.call.status} : {}),
    ...(item.state === undefined ? {} : {state: item.state}),
    ...(item.stopReason === undefined ? {} : {stopReason: String(item.stopReason).slice(0, 1024)}),
    ...(item.error === undefined ? {} : {error: String(item.error).slice(0, 1024)})})
}
function mergeTool(previous: Tool, incoming: Tool): Tool {
  const {kind, status, title, name, content, locations, ...payload} = incoming
  return {...previous, ...payload, sessionUpdate: "tool_call_update",
    ...(kind == null ? {} : {kind}), ...(status == null ? {} : {status}),
    ...(title == null ? {} : {title}), ...(name == null ? {} : {name}),
    ...(content == null ? {} : {content}), ...(locations == null ? {} : {locations})}
}
function queryLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new TypeError("Недопустимый предел страницы истории")
  return value
}
function cursorValue(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new TypeError("Недопустимый cursor истории")
}

/** Приватный handle; размер его состояния не зависит от количества записей. */
export class Archive {
  private header: Header
  private writing: Promise<void> = Promise.resolve()
  private queuedBytes = 0
  private queuedCount = 0
  private maximumQueuedBytes = 0
  private closed = false
  private initialized = false
  private sourceExists: boolean
  private recoveryBytes = 0
  readonly media: ReturnType<typeof createMediaStore>
  readonly cacheFile: string
  constructor(readonly file: string, metadata: ArchiveMetadata, cacheDirectory?: string, header?: Header) {
    this.media = createMediaStore(dirname(file))
    this.header = header ?? {schemaVersion: 3, metadata: structuredClone(metadata), history: {revision: 0, total: 0, lastSequence: 0},
      journal: `${basename(file)}.journal.${randomUUID()}.ndjson`, committedBytes: 0, hash: ZERO_HASH}
    this.sourceExists = header !== undefined
    this.cacheFile = join(cacheDirectory ?? join(dirname(dirname(file)), "data/chat"), `${digest(file)}.sqlite`)
  }
  get metadata(): ArchiveMetadata { return structuredClone(this.header.metadata) }
  get exists(): boolean { return this.sourceExists }
  stats(): HistoryState { return {...this.header.history} }
  /** Проверяемый предел residency; не содержит ссылок на историю. */
  residency() { return {entries: 0, queuedBytes: this.queuedBytes, queuedCount: this.queuedCount,
    maximumQueuedBytes: this.maximumQueuedBytes, openDatabases: pool.size, activeWriteLeases: writeLeases.size, uncommittedBytes: this.recoveryBytes} }
  private db(): Database {
    if (!this.initialized) throw new Error("Индекс истории ещё не подготовлен")
    return database(this.cacheFile)
  }
  private row(id: string): Row | null {
    return !this.initialized ? null : cachedQuery(this.db(), `SELECT ${SMALL_COLUMNS} FROM entry WHERE id=?`).get(id) as Row | null
  }
  lookup(id: string): HistoryEntry | null { const row = this.row(id); return row === null ? null : headerEntry(row) }
  findProvider(role: string, providerId: string): HistoryEntry | null {
    if (!this.initialized) return null
    const rows = cachedQuery(this.db(), `SELECT ${SMALL_COLUMNS} FROM entry WHERE provider_id=? ORDER BY ordinal LIMIT 1`).get(`${role}\0${providerId}`) as Row | null
    return rows === null ? null : headerEntry(rows)
  }
  findTool(toolCallId: string): HistoryEntry | null {
    if (!this.initialized) return null
    const row = cachedQuery(this.db(), `SELECT ${SMALL_COLUMNS} FROM entry WHERE tool_id=? ORDER BY ordinal LIMIT 1`).get(toolCallId) as Row | null
    return row === null ? null : headerEntry(row)
  }
  lastAssistant(afterSequence: number): HistoryEntry | null {
    if (!this.initialized) return null
    const row = cachedQuery(this.db(), `SELECT ${SMALL_COLUMNS} FROM entry WHERE kind='message' AND sequence>=? AND json_extract(preview,'$.role')='assistant' ORDER BY sequence DESC LIMIT 1`).get(afterSequence) as Row | null
    return row === null ? null : headerEntry(row)
  }
  unfinishedRequest(): string | undefined {
    if (!this.initialized) return undefined
    const started = cachedQuery(this.db(), "SELECT json_extract(data,'$.requestId') AS request FROM entry WHERE kind='turn' AND json_extract(preview,'$.state')='started' ORDER BY ordinal DESC LIMIT 1").get() as {request: string} | null
    if (started === null) return undefined
    const completed = cachedQuery(this.db(), "SELECT 1 FROM entry WHERE kind='turn' AND json_extract(data,'$.requestId')=? AND json_extract(preview,'$.state')!='started' LIMIT 1").get(started.request)
    return completed === null ? started.request : undefined
  }
  hasStarted(requestId: string): boolean {
    return this.initialized && cachedQuery(this.db(), "SELECT 1 FROM entry WHERE kind='turn' AND json_extract(data,'$.requestId')=? AND json_extract(preview,'$.state')='started' LIMIT 1").get(requestId) !== null
  }
  hasTerminal(requestId: string): boolean {
    return this.initialized && cachedQuery(this.db(), "SELECT 1 FROM entry WHERE kind='turn' AND json_extract(preview,'$.state')!='started' AND json_extract(data,'$.requestId')=? LIMIT 1").get(requestId) !== null
  }
  private identity(db: Database, id: string, sequence: number, parent: string): void {
    // Первый raw event имеет sequence самой записи; остальные sequence глобально уникальны.
    cachedQuery(db, "INSERT INTO identity(id,sequence,entry_id) VALUES(?,?,?)").run(id, sequence, parent)
  }
  hasMedia(digest: string): boolean {
    return /^[a-f0-9]{64}$/u.test(digest) && this.initialized && cachedQuery(this.db(), "SELECT 1 FROM entry_media WHERE digest=? LIMIT 1").get(digest) !== null
  }
  private indexMedia(db: Database, id: string, value: unknown): void {
    for (const reference of mediaReferences(value)) cachedQuery(db, "INSERT OR IGNORE INTO entry_media(entry_id,digest) VALUES(?,?)").run(id, reference.digest)
  }
  private addBlock(db: Database, id: string, content: Content): void {
    this.indexMedia(db, id, content)
    const encoded = JSON.stringify(content)
    cachedQuery(db, "INSERT INTO block(entry_id,ordinal,bytes,data) VALUES(?,(SELECT COALESCE(MAX(ordinal),-1)+1 FROM block WHERE entry_id=?),?,?)").run(id, id, Buffer.byteLength(encoded), encoded)
    cachedQuery(db, "UPDATE entry SET body_bytes=body_bytes+? WHERE id=?").run(Buffer.byteLength(encoded), id)
  }
  private addEvidence(db: Database, id: string, event: HistoryEvidence): void {
    this.indexMedia(db, id, event)
    const encoded = JSON.stringify(event)
    // Sequence совпадает только у entry и первого события; для identity сырого события сохраняется 0 в этом случае.
    const row = cachedQuery(db, "SELECT sequence FROM entry WHERE id=?").get(id) as {sequence: number}
    this.identity(db, event.id, event.sequence === row.sequence ? 0 : event.sequence, id)
    cachedQuery(db, "INSERT INTO evidence(entry_id,ordinal,id,sequence,bytes,data) VALUES(?,(SELECT COALESCE(MAX(ordinal),-1)+1 FROM evidence WHERE entry_id=?),?,?,?,?)").run(id, id, event.id, event.sequence, Buffer.byteLength(encoded), encoded)
    cachedQuery(db, "UPDATE entry SET evidence_count=evidence_count+1 WHERE id=?").run(id)
    const update = event.update as Record<string, any>
    const meta = update?._meta
    const delta = meta?.terminal_output_delta
    const exit = meta?.terminal_exit
    const info = meta?.terminal_info
    if (delta && typeof delta === "object" || exit && typeof exit === "object" || info && typeof info === "object") {
      if (event.origin === "replay" && event.batchId && typeof delta?.data === "string") {
        const key = `terminal-replay:${id}`
        const previous = cachedQuery(db, "SELECT value FROM stamp WHERE key=?").get(key) as {value: string} | null
        if (previous?.value !== event.batchId) {
          // Полный повтор вывода заменяет только его проекцию; исходные evidence остаются.
          cachedQuery(db, "DELETE FROM terminal_event WHERE entry_id=? AND has_output=1").run(id)
          cachedQuery(db, "INSERT OR REPLACE INTO stamp(key,value) VALUES(?,?)").run(key, event.batchId)
        }
      }
      const ordinal = (cachedQuery(db, "SELECT ordinal FROM evidence WHERE id=?").get(event.id) as {ordinal: number}).ordinal
      cachedQuery(db, "INSERT OR REPLACE INTO terminal_event(entry_id,evidence_id,ordinal,sequence,stream,has_output,terminal_id,cwd,exit_code,exit_signal,has_exit) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, event.id, ordinal, event.sequence, ["stdout", "stderr"].includes(delta?.stream) ? delta.stream : "combined",
          Number(typeof delta?.data === "string"), delta?.terminal_id ?? exit?.terminal_id ?? info?.terminal_id ?? null,
          typeof info?.cwd === "string" ? info.cwd : null, Number.isInteger(exit?.exit_code) ? exit.exit_code : null,
          typeof exit?.signal === "string" ? exit.signal : null, Number(exit !== undefined && exit !== null))
    }
  }
  /** Digest читается по блокам: корпус и растущий список request не удерживаются в RAM. */
  private inputDigest(db: Database, ids: readonly string[]): string {
    const hash = createHash("sha256").update("[")
    let first = true
    for (const id of ids) for (const block of cachedQuery(db, "SELECT data FROM block WHERE entry_id=? ORDER BY ordinal").iterate(id) as Iterable<{data: string}>) {
      if (!first) hash.update(",")
      hash.update(contentEncoding(JSON.parse(block.data)))
      first = false
    }
    return hash.update("]").digest("hex")
  }
  private blocks(db: Database, id: string): Content[] {
    const row = cachedQuery(db, "SELECT body_bytes FROM entry WHERE id=?").get(id) as {body_bytes: number} | null
    if (row === null || row.body_bytes > BODY_LIMIT) throw new Error("Тело записи превышает предел ограниченного сопоставления")
    return (cachedQuery(db, "SELECT data FROM block WHERE entry_id=? ORDER BY ordinal").all(id) as {data: string}[]).map(block => JSON.parse(block.data))
  }
  private indexSuppliedInput(db: Database, item: Item, revision: number): void {
    if (item.kind === "turn" && item.state === "started") {
      const user = cachedQuery(db, "SELECT data,body_bytes FROM entry WHERE id=? AND kind='message' AND origin='local'").get(`user:${item.requestId}`) as {data: string; body_bytes: number} | null
      if (user !== null && user.body_bytes <= BODY_LIMIT) {
        const data = JSON.parse(user.data)
        this.indexSuppliedInput(db, {...data, content: this.blocks(db, data.id)}, revision)
      }
      return
    }
    if (item.kind === "message" && item.origin === "local" && item.role === "user" && item.id.startsWith("user:")) {
      const requestId = item.id.slice(5)
      const imageEcho = codexImageEcho(item.content)
      const echo = imageEcho ?? (item.content.every(block => block.type === "text" && typeof block.text === "string") ? item.content.map(block => (block as {text: string}).text).join("") : null)
      const echoKind = imageEcho === null ? CODEX_TEXT_ECHO : CODEX_IMAGE_ECHO
      const started = cachedQuery(db, "SELECT 1 FROM entry WHERE kind='turn' AND json_extract(preview,'$.state')='started' AND json_extract(data,'$.requestId')=? LIMIT 1").get(requestId) !== null
      if (started && echo !== null && Buffer.byteLength(echo) <= BODY_LIMIT) {
        const inputHash = digest(echo)
        cachedQuery(db, "INSERT OR REPLACE INTO supplied_input(context_id,request_id,bootstrap_hash,input_hash) VALUES(?,?,?,?)")
          .run(item.id, requestId, echoKind, inputHash)
        for (const replay of cachedQuery(db, "SELECT entry_id FROM replay_input WHERE bootstrap_hash=? AND input_hash=?")
          .iterate(echoKind, inputHash) as Iterable<{entry_id: string}>) this.materializeReplay(db, replay.entry_id, revision)
      }
      for (const context of cachedQuery(db, "SELECT data FROM entry WHERE kind='context' AND origin='local' AND json_extract(data,'$.requestId')=? AND body_bytes<=?")
        .iterate(requestId, BODY_LIMIT) as Iterable<{data: string}>) {
        const data = JSON.parse(context.data)
        this.indexSuppliedInput(db, {...data, content: this.blocks(db, data.id)}, revision)
      }
      return
    }
    if (item.kind !== "context" || item.origin !== "local" || !item.requestId || item.content.length !== 1 || item.content[0]?.type !== "text") return
    const userId = `user:${item.requestId}`
    const user = cachedQuery(db, "SELECT origin,kind,preview,body_bytes FROM entry WHERE id=?").get(userId) as Pick<Row, "origin" | "kind" | "preview" | "body_bytes"> | null
    if (user?.kind !== "message" || user.origin !== "local" || user.body_bytes > BODY_LIMIT || JSON.parse(user.preview).role !== "user") return
    if (Buffer.byteLength(JSON.stringify(item.content[0])) > BODY_LIMIT) return
    const bootstrapHash = digest(contentEncoding(item.content[0]))
    const inputHash = this.inputDigest(db, [item.id, userId])
    const fingerprints = [{bootstrapHash, inputHash}]
    const echo = codexImageEcho([...item.content, ...this.blocks(db, userId)])
    const started = cachedQuery(db, "SELECT 1 FROM entry WHERE kind='turn' AND json_extract(preview,'$.state')='started' AND json_extract(data,'$.requestId')=? LIMIT 1").get(item.requestId) !== null
    if (started && echo !== null && Buffer.byteLength(echo) <= BODY_LIMIT) fingerprints.push({bootstrapHash: CODEX_IMAGE_ECHO, inputHash: digest(echo)})
    for (const fingerprint of fingerprints) {
      cachedQuery(db, "INSERT OR REPLACE INTO supplied_input(context_id,request_id,bootstrap_hash,input_hash) VALUES(?,?,?,?)")
        .run(item.id, item.requestId, fingerprint.bootstrapHash, fingerprint.inputHash)
      for (const replay of cachedQuery(db, "SELECT entry_id FROM replay_input WHERE bootstrap_hash=? AND input_hash=?")
        .iterate(fingerprint.bootstrapHash, fingerprint.inputHash) as Iterable<{entry_id: string}>) this.materializeReplay(db, replay.entry_id, revision)
    }
  }
  /** Точное соответствие вычисляется при записи/rebuild; header чтение никогда не раскрывает payload. */
  private materializeReplay(db: Database, id: string, revision: number): void {
    const fingerprints = cachedQuery(db, "SELECT bootstrap_hash,input_hash FROM replay_input WHERE entry_id=? LIMIT 2").all(id) as {bootstrap_hash: string; input_hash: string}[]
    if (!fingerprints.length) return
    const previous = cachedQuery(db, "SELECT context_id FROM replay_projection WHERE entry_id=?").get(id) as {context_id: string} | null
    const matches: {context_id: string; request_id: string | null}[] = []
    let ambiguous = false
    for (const fingerprint of fingerprints) {
      const candidates = cachedQuery(db, "SELECT context_id,request_id FROM supplied_input WHERE bootstrap_hash=? AND input_hash=? LIMIT 2")
        .all(fingerprint.bootstrap_hash, fingerprint.input_hash) as {context_id: string; request_id: string}[]
      const exactBootstrap = fingerprint.bootstrap_hash !== CODEX_TEXT_ECHO && fingerprint.bootstrap_hash !== CODEX_IMAGE_ECHO
      if (candidates.length > 1 && !exactBootstrap) { ambiguous = true; continue }
      const candidate = candidates[0]
      if (candidate === undefined) continue
      const replay = this.blocks(db, id)
      const supplied = this.blocks(db, candidate.context_id)
      const content = candidate.context_id === `user:${candidate.request_id}` ? supplied : [...supplied, ...this.blocks(db, `user:${candidate.request_id}`)]
      const confirmed = fingerprint.bootstrap_hash === CODEX_TEXT_ECHO
        ? replay.every(block => block.type === "text") && content.every(block => block.type === "text") && replay.map(block => echoText((block as {text: unknown}).text)).join("") === content.map(block => echoText((block as {text: unknown}).text)).join("")
        : fingerprint.bootstrap_hash === CODEX_IMAGE_ECHO
        ? replay.every(block => block.type === "text") && replay.map(block => block.type === "text" ? echoText(block.text) : "").join("") === codexImageEcho(content)
        : contentEncoding(replay) === contentEncoding(content)
      // Наличие точного собственного envelope доказано независимо от identity попытки.
      // Повтор одинакового вопроса не превращает bootstrap в пользовательский Markdown.
      // Ссылка context_id выбирает идентичные bytes; requestId при этом не приписывается.
      if (confirmed) matches.push({...candidate, request_id: candidates.length > 1 ? null : candidate.request_id})
    }
    const match = !ambiguous && matches.length === 1 ? matches[0] : undefined
    if (match === undefined) {
      if (previous !== null) {
        cachedQuery(db, "DELETE FROM replay_projection WHERE entry_id=?").run(id)
        cachedQuery(db, "UPDATE entry SET revision=? WHERE id=?").run(revision, id)
        syncDisplayMessage(db, id, revision)
      }
      return
    }
    const context = cachedQuery(db, "SELECT body_bytes FROM entry WHERE id=?").get(match.context_id) as {body_bytes: number}
    cachedQuery(db, "INSERT OR REPLACE INTO replay_projection(entry_id,context_id,request_id,body_bytes) VALUES(?,?,?,?)")
      .run(id, match.context_id, match.request_id, context.body_bytes)
    cachedQuery(db, "UPDATE entry SET revision=? WHERE id=?").run(revision, id)
    syncDisplayMessage(db, id, revision)
  }
  /** Только собственный envelope с native identity может стать кандидатом exact supplied replay. */
  private indexReplay(db: Database, id: string, revision: number): void {
    const row = cachedQuery(db, `SELECT ${SMALL_COLUMNS} FROM entry WHERE id=?`).get(id) as Row | null
    if (row === null || row.kind !== "message" || row.origin !== "replay" || JSON.parse(row.preview).role !== "user") return
    cachedQuery(db, "DELETE FROM replay_input WHERE entry_id=?").run(id)
    cachedQuery(db, "DELETE FROM replay_projection WHERE entry_id=?").run(id)
    if (row.provider_id === null || row.body_bytes > BODY_LIMIT) return
    const first = cachedQuery(db, "SELECT data FROM block WHERE entry_id=? AND ordinal=0").get(id) as {data: string} | null
    if (first === null) return
    const block: Content = JSON.parse(first.data)
    if (block.type !== "text") return
    let envelope: unknown
    try { envelope = JSON.parse(block.text) } catch {}
    const environment = envelope !== null && typeof envelope === "object" && Object.keys(envelope).length === 1 && "environment" in envelope ? envelope.environment : undefined
    if (environment !== null && typeof environment === "object" && "executorId" in environment && environment.executorId === this.header.metadata.executorId &&
      "subject" in environment && environment.subject !== null && typeof environment.subject === "object" && "address" in environment.subject && environment.subject.address === this.header.metadata.address) {
      cachedQuery(db, "INSERT OR REPLACE INTO replay_input(entry_id,bootstrap_hash,input_hash) VALUES(?,?,?)")
        .run(id, digest(contentEncoding(block)), this.inputDigest(db, [id]))
    }
    const content = this.blocks(db, id)
    if (content.every(block => block.type === "text")) {
      const text = content.map(block => block.type === "text" ? echoText(block.text) : "").join("")
      if (!text.includes("[@image](")) cachedQuery(db, "INSERT OR REPLACE INTO replay_input(entry_id,bootstrap_hash,input_hash) VALUES(?,?,?)").run(id, CODEX_TEXT_ECHO, digest(text))
      if (text.includes("[@image](")) cachedQuery(db, "INSERT OR REPLACE INTO replay_input(entry_id,bootstrap_hash,input_hash) VALUES(?,?,?)")
        .run(id, CODEX_IMAGE_ECHO, digest(text))
    }
    this.materializeReplay(db, id, revision)
  }
  private replayContext(row: Row): {context_id: string; request_id: string | null; body_bytes: number} | null {
    return cachedQuery(this.db(), "SELECT context_id,request_id,body_bytes FROM replay_projection WHERE entry_id=?").get(row.id) as {context_id: string; request_id: string | null; body_bytes: number} | null
  }
  private projectedHeader(row: Row): HistoryEntry {
    const context = this.replayContext(row)
    return context === null ? headerEntry(row) : headerEntry({...row, kind: "context", preview: "{}", body_bytes: context.body_bytes})
  }
  private apply(db: Database, mutation: StoredMutation, revision: number): number {
    const delta = this.applyRaw(db, mutation, revision)
    const id = mutation.type === "append" ? mutation.item.id : mutation.type === "create" ? String(mutation.entry.id) : mutation.id
    syncDisplayMessage(db, id, revision)
    if (mutation.type === "remove") removeOccurrences(db, id, revision)
    else {
      const row = cachedQuery(db, "SELECT kind,preview,data,sequence FROM entry WHERE id=?").get(id) as {kind: string; preview: string; data: string; sequence: number} | null
      if (row !== null) {
        const data = JSON.parse(row.data)
        const event = mutation.type === "create" || mutation.type === "update" ? mutation.event : undefined
        // Replay обновляет evidence существующей identity, не создавая нового выполнения.
        if (event?.origin !== "replay" || mutation.type === "create") {
          const events = event ? [event] : mutation.type === "append" && (mutation.item.kind === "tool" || mutation.item.kind === "message") ? mutation.item.updates ?? [] : []
          if (events.length) for (const occurrence of events) indexOccurrence(db, {id: occurrence.id, sequence: occurrence.sequence,
            entryId: id, evidenceId: occurrence.id, revision, preview: preview({...data, call: occurrence.update}),
            requestId: (occurrence as HistoryEvidence).requestId ?? data.requestId ?? data.turnId,
            ...((occurrence as HistoryEvidence).receivedAt === undefined ? {} : {receivedAt: (occurrence as HistoryEvidence).receivedAt!})})
          else indexOccurrence(db, {id, sequence: row.sequence, entryId: id, revision, preview: row.preview,
            requestId: data.requestId ?? data.turnId, receivedAt: data.receivedAt})
        }
      }
    }
    return delta
  }
  private applyRaw(db: Database, mutation: StoredMutation, revision: number): number {
    if (mutation.type === "create") {
      const update = mutation.event.update as Update
      const entry = mutation.entry
      const candidate = entry.kind === "message" && "content" in update
        ? {...entry, content: [update.content], updates: [mutation.event]}
        : {...entry, call: update, updates: [mutation.event]}
      readHistory(projectMedia([candidate]))
      const item = candidate as unknown as Item
      const delta = this.apply(db, {type: "append", item}, revision)
      if (mutation.event.origin === "replay" && entry.kind === "message") cachedQuery(db, "UPDATE entry SET replay_batch=? WHERE id=?").run(mutation.event.batchId ?? null, String(entry.id))
      return delta
    }
    if (mutation.type === "remove") {
      cachedQuery(db, "DELETE FROM supplied_input WHERE context_id=? OR request_id=?").run(mutation.id, mutation.id.startsWith("user:") ? mutation.id.slice(5) : "")
      cachedQuery(db, "DELETE FROM replay_input WHERE entry_id=?").run(mutation.id)
      cachedQuery(db, "DELETE FROM replay_projection WHERE entry_id=? OR context_id=? OR request_id=?").run(mutation.id, mutation.id, mutation.id.startsWith("user:") ? mutation.id.slice(5) : "")
      cachedQuery(db, "DELETE FROM stamp WHERE key=?").run(`terminal-replay:${mutation.id}`)
      cachedQuery(db, "DELETE FROM terminal_event WHERE entry_id=?").run(mutation.id)
      cachedQuery(db, "DELETE FROM entry_media WHERE entry_id=?").run(mutation.id)
      cachedQuery(db, "DELETE FROM block WHERE entry_id=?").run(mutation.id)
      cachedQuery(db, "DELETE FROM evidence WHERE entry_id=?").run(mutation.id)
      cachedQuery(db, "DELETE FROM identity WHERE entry_id=?").run(mutation.id)
      const removed = cachedQuery(db, "DELETE FROM entry WHERE id=?").run(mutation.id)
      return -removed.changes
    }
    if (mutation.type === "purpose") {
      const row = cachedQuery(db, "SELECT * FROM entry WHERE id=?").get(mutation.id) as Row | null
      if (row === null || row.kind !== "message") throw new Error("Команда не имеет сохранённого сообщения")
      cachedQuery(db, "UPDATE entry SET data=?,preview=?,revision=? WHERE id=?").run(JSON.stringify({...JSON.parse(row.data!), purpose: "command"}), preview({...JSON.parse(row.preview), purpose: "command"}), revision, mutation.id)
      return 0
    }
    if (mutation.type === "append") {
      const item = mutation.item
      readHistory(projectMedia([item]))
      const previous = cachedQuery(db, "SELECT sequence FROM entry ORDER BY ordinal DESC LIMIT 1").get() as {sequence: number} | null
      if (previous !== null && item.sequence <= previous.sequence) throw new Error("Нарушен первоначальный порядок timeline")
      const ordinal = (cachedQuery(db, "SELECT COALESCE(MAX(ordinal),-1)+1 AS ordinal FROM entry").get() as {ordinal: number}).ordinal
      this.indexMedia(db, item.id, item)
      const data = compactData(item)
      const encoded = JSON.stringify(data)
      this.identity(db, item.id, item.sequence, item.id)
      cachedQuery(db, "INSERT INTO entry(id,ordinal,sequence,revision,kind,origin,preview,data,body_bytes,provider_id,tool_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
        item.id, ordinal, item.sequence, revision, item.kind, item.origin, preview(item), encoded,
        item.kind !== "message" && item.kind !== "context" ? Buffer.byteLength(encoded) : 0,
        item.kind === "message" && item.providerMessageId !== undefined ? `${item.role}\0${item.providerMessageId}` : null,
        item.kind === "tool" ? item.toolCallId : null)
      if (item.kind === "message" || item.kind === "context") for (const content of item.content) this.addBlock(db, item.id, content)
      if (item.kind === "tool" || item.kind === "message") for (const event of item.updates ?? []) this.addEvidence(db, item.id, event)
      this.indexSuppliedInput(db, item, revision)
      this.indexReplay(db, item.id, revision)
      return 1
    }
    const row = cachedQuery(db, "SELECT * FROM entry WHERE id=?").get(mutation.id) as Row | null
    if (row === null) throw new Error("Обновление не имеет сохранённой записи")
    const data = JSON.parse(row.data!)
    const update = mutation.event.update as Update
    if (row.kind === "message" && (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "user_message_chunk" || update.sessionUpdate === "agent_thought_chunk")) {
      if (mutation.reset) {
        cachedQuery(db, "DELETE FROM block WHERE entry_id=?").run(row.id)
        cachedQuery(db, "UPDATE entry SET body_bytes=0 WHERE id=?").run(row.id)
      }
      this.addBlock(db, row.id, update.content)
    } else if (row.kind === "tool" && (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update")) {
      data.call = mergeTool(data.call, update)
      const encoded = JSON.stringify(data)
      cachedQuery(db, "UPDATE entry SET data=?,preview=?,body_bytes=? WHERE id=?").run(encoded, preview(data), Buffer.byteLength(encoded), row.id)
    } else throw new Error("Обновление не соответствует виду записи")
    this.addEvidence(db, row.id, mutation.event)
    cachedQuery(db, "UPDATE entry SET revision=?,replay_batch=COALESCE(?,replay_batch) WHERE id=?").run(revision, mutation.replayBatch ?? null, row.id)
    this.indexReplay(db, row.id, revision)
    return 0
  }
  private stamp(db: Database, header: Header): void {
    cachedQuery(db, "INSERT OR REPLACE INTO stamp(key,value) VALUES('source',?)").run(this.sourceStamp(header))
  }
  private sourceStamp(header: Header): string {
    const info = statSync(join(dirname(this.file), header.journal))
    return `display-occurrences-v5:${header.hash}:${header.committedBytes}:${info.mtimeMs}:${info.ctimeMs}:${info.size}`
  }
  async initialize(): Promise<void> {
    await writeLease(this.file, async () => { await this.initializeLeased() })
  }
  private async initializeLeased(): Promise<void> {
    if (this.initialized || !this.sourceExists) return
    // Header мог измениться, пока open ожидал чужой writer lease.
    const publishedInfo = await stat(this.file)
    if (publishedInfo.size > 1024 * 1024) throw new Error("Заголовок дисковой истории превышает 1 MiB")
    const published = JSON.parse(await readFile(this.file, "utf8")) as Header
    if (published.schemaVersion !== 3 || published.metadata?.id !== this.header.metadata.id || published.metadata?.address !== this.header.metadata.address ||
      typeof published.journal !== "string" || basename(published.journal) !== published.journal ||
      !Number.isSafeInteger(published.committedBytes) || published.committedBytes < 0 || !/^[a-f0-9]{64}$/u.test(published.hash)) {
      throw new Error("Identity или подтверждение истории изменены во время открытия")
    }
    this.header = published
    await mkdir(dirname(this.cacheFile), {recursive: true})
    const journal = join(dirname(this.file), this.header.journal)
    const source = await stat(journal)
    if (source.size < this.header.committedBytes) throw new Error("Подтверждённый журнал истории обрезан; исходная история не заменена")
    this.recoveryBytes = source.size - this.header.committedBytes
    let db: Database
    try { db = database(this.cacheFile) } catch {
      closeDatabase(this.cacheFile)
      await unlink(this.cacheFile).catch(error => { if (error.code !== "ENOENT") throw error })
      db = database(this.cacheFile)
    }
    const saved = cachedQuery(db, "SELECT value FROM stamp WHERE key='source'").get() as {value: string} | null
    if (saved?.value === this.sourceStamp(this.header)) { this.initialized = true; return }
    db.exec("DELETE FROM stamp; DELETE FROM block; DELETE FROM evidence; DELETE FROM identity; DELETE FROM entry; DELETE FROM supplied_input; DELETE FROM replay_input; DELETE FROM replay_projection;")
    db.exec("DELETE FROM entry_media; DELETE FROM terminal_event;")
    clearProjection(db)
    let offset = 0
    let hash = ZERO_HASH
    let revision = 0
    let lastSequence = 0
    for await (const encoded of journalLines(journal, this.header.committedBytes)) {
      const transaction = JSON.parse(encoded) as Transaction
      if (transaction.schemaVersion !== 1 || transaction.previous !== hash || !Array.isArray(transaction.mutations)) throw new Error("Повреждена цепочка подтверждённого журнала истории")
      revision += 1
      const current = database(this.cacheFile)
      current.transaction(() => { for (const mutation of transaction.mutations) {
        this.apply(current, mutation, revision)
        lastSequence = Math.max(lastSequence, mutation.type === "append" ? maximumSequence(mutation.item) : mutation.type === "update" || mutation.type === "create" ? mutation.event.sequence : 0)
      } })()
      offset += Buffer.byteLength(encoded) + 1
      hash = digest(hash + encoded)
    }
    db = database(this.cacheFile)
    const total = (cachedQuery(db, "SELECT COUNT(*) AS total FROM entry").get() as {total: number}).total
    if (offset !== this.header.committedBytes || hash !== this.header.hash || revision !== this.header.history.revision || total !== this.header.history.total || lastSequence !== this.header.history.lastSequence) {
      throw new Error("Подтверждённый журнал не совпадает с заголовком истории")
    }
    this.stamp(db, this.header)
    this.initialized = true
  }
  private enqueue<T>(encoded: string, work: (value: any) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Хранилище истории закрыто"))
    const bytes = Buffer.byteLength(encoded)
    if (bytes > RECORD_LIMIT || this.queuedBytes + bytes > QUEUE_LIMIT || this.queuedCount >= 128) return Promise.reject(new Error("Очередь записи истории заполнена; вызывающий должен ожидать предыдущую запись"))
    this.queuedBytes += bytes
    this.queuedCount += 1
    this.maximumQueuedBytes = Math.max(this.maximumQueuedBytes, this.queuedBytes)
    const result = this.writing.then(() => work(JSON.parse(encoded)))
    this.writing = result.then(() => {}, () => {}).finally(() => { this.queuedBytes -= bytes; this.queuedCount -= 1 })
    return result
  }
  commit(metadata: ArchiveMetadata | undefined, mutations: readonly ArchiveMutation[] = []): Promise<void> {
    return this.enqueue(JSON.stringify({metadata, mutations}), async input => {
      input = await this.media.normalize(input)
      // Повтор сохранения тех же metadata не создаёт ревизию и fsync без новых данных.
      if (this.sourceExists && input.mutations.length === 0 && JSON.stringify(input.metadata ?? this.header.metadata) === JSON.stringify(this.header.metadata)) return
      let sequence = this.header.history.lastSequence
      const stored = input.mutations.map((mutation: ArchiveMutation): StoredMutation => {
        if (mutation.type !== "append") return mutation
        const item = {...mutation.item, receivedAt: (mutation.item as Item & {receivedAt?: string}).receivedAt ?? new Date().toISOString(), sequence: mutation.item.sequence ?? ++sequence} as Item
        sequence = Math.max(sequence, maximumSequence(item))
        return {type: "append", item}
      })
      await this.writeTransaction(input.metadata ?? this.header.metadata, stored)
    })
  }
  receive(update: Update, origin: "live" | "replay" | "local", cursor: ArchiveCursor): Promise<void> {
    return this.enqueue(JSON.stringify({update, origin}), async input => {
      input = await this.media.normalize(input)
      const update = input.update as Update
      const sequence = this.header.history.lastSequence + 1
      const batchId = origin === "replay" ? cursor.batchId ??= randomUUID() : undefined
      const entry = {id: randomUUID(), sequence, origin, receivedAt: new Date().toISOString(), ...(batchId === undefined ? {} : {batchId})}
      const event: HistoryEvidence = {...entry, id: randomUUID(), update, ...(origin === "replay" || this.header.metadata.activeRequest === undefined ? {} : {requestId: this.header.metadata.activeRequest})}
      let mutation: StoredMutation
      if (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "user_message_chunk" || update.sessionUpdate === "agent_thought_chunk") {
        const role = update.sessionUpdate === "user_message_chunk" ? "user" : update.sessionUpdate === "agent_thought_chunk" ? "thought" : "assistant"
        const identified = update.messageId == null ? null : this.findProvider(role, update.messageId)
        const continued = update.messageId == null && origin === "live" && cursor.message !== undefined ? this.lookup(cursor.message) : null
        const existing = identified ?? (continued?.kind === "message" && continued.role === role && continued.origin === "live" ? continued : null)
        if (existing !== null) {
          const row = this.row(existing.id)!
          mutation = {type: "update", id: existing.id, event, reset: origin === "replay" && row.replay_batch !== batchId,
            ...(batchId === undefined ? {} : {replayBatch: batchId})}
          cursor.message = existing.id
        } else {
          mutation = {type: "create", entry: {...entry, kind: "message", role,
            ...(update.messageId == null ? {} : {providerMessageId: update.messageId}),
            ...(origin === "replay" && update.messageId == null ? {diagnostic: "ACP replay не предоставил messageId: тождество с локальной историей не установлено."} : {})}, event}
          cursor.message = entry.id
        }
      } else {
        delete cursor.message
        if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
          const existing = this.findTool(update.toolCallId)
          mutation = existing === null ? {type: "create", entry: {...entry, kind: "tool", toolCallId: update.toolCallId}, event}
            : {type: "update", id: existing.id, event}
        } else mutation = {type: "append", item: {...entry, kind: "event", update}}
      }
      await this.writeTransaction(this.header.metadata, [mutation])
    })
  }
  private async writeTransaction(metadata: ArchiveMetadata, mutations: StoredMutation[]): Promise<void> {
    await writeLease(this.file, async () => {
      const source = await stat(this.file).catch(error => { if (error.code === "ENOENT") return null; throw error })
      if (source === null) {
        if (this.sourceExists) throw new Error("Сохранённый заголовок истории исчез; writer требуется открыть повторно")
      } else {
        if (source.size > 1024 * 1024) throw new Error("Заголовок истории превышает 1 MiB")
        const current = JSON.parse(await readFile(this.file, "utf8")) as Header
        if (!this.sourceExists || current.schemaVersion !== 3 || current.hash !== this.header.hash ||
          current.committedBytes !== this.header.committedBytes || current.journal !== this.header.journal || current.metadata?.id !== this.header.metadata.id) {
          throw new Error("История изменена другим writer; откройте хранилище повторно")
        }
      }
      await this.writeConfirmedTransaction(metadata, mutations)
    })
  }
  private async writeConfirmedTransaction(metadata: ArchiveMetadata, mutations: StoredMutation[]): Promise<void> {
    if (!this.initialized) {
      await mkdir(dirname(this.cacheFile), {recursive: true})
      database(this.cacheFile)
      this.initialized = true
    }
    this.db()
    const encoded = JSON.stringify({schemaVersion: 1, previous: this.header.hash, metadata, mutations} satisfies Transaction)
    if (Buffer.byteLength(encoded) > RECORD_LIMIT) throw new Error("Одна транзакция истории превышает 64 MiB; источник не изменён")
    if (Buffer.byteLength(JSON.stringify(metadata)) > 512 * 1024) throw new Error("Метаданные истории превышают 512 KiB; источник не изменён")
    const revision = this.header.history.revision + 1
    const db = new Database(this.cacheFile)
    try {
      db.exec("PRAGMA cache_size=-2048; PRAGMA temp_store=FILE; PRAGMA synchronous=NORMAL;")
      db.exec("BEGIN")
      let total = this.header.history.total
      for (const mutation of mutations) total += this.apply(db, mutation, revision)
      const lastSequence = mutations.reduce((last, mutation) => Math.max(last, mutation.type === "append" ? maximumSequence(mutation.item) : mutation.type === "update" || mutation.type === "create" ? mutation.event.sequence : 0), this.header.history.lastSequence)
      const counts = cachedQuery(db, "SELECT (SELECT COUNT(*) FROM display_message)+(SELECT COUNT(*) FROM service_group) AS total").get() as {total: number}
      const next: Header = {...this.header, metadata: structuredClone(metadata), history: {revision, total, lastSequence},
        displayHistory: {revision, total: counts.total, lastSequence},
        committedBytes: this.header.committedBytes + Buffer.byteLength(encoded) + 1, hash: digest(this.header.hash + encoded)}
      // Отдельное соединение держит неподтверждённую транзакцию; читатели
      // продолжают видеть старый индекс до fsync источника. Мутации применяются один раз.
      await mkdir(dirname(this.file), {recursive: true})
      const handle = await open(join(dirname(this.file), this.header.journal), "a+", 0o600)
      try {
        if ((await handle.stat()).size !== this.header.committedBytes) await handle.truncate(this.header.committedBytes)
        await handle.writeFile(encoded + "\n")
        await handle.sync()
      } finally { await handle.close() }
      await atomicHeader(this.file, next)
      // Источник подтверждён: сбой disposable индекса после этой точки не отменяет принятую запись.
      this.header = next
      this.sourceExists = true
      this.recoveryBytes = 0
      try {
        this.stamp(db, next)
        db.exec("COMMIT")
      } catch {
        try {db.exec("ROLLBACK")} catch {}
        this.initialized = false
        await this.initializeLeased()
      }
    } catch (error) {
      try { db.exec("ROLLBACK") } catch {}
      throw error
    } finally {db.close()}
  }
  content(id: string): Content[] {
    const row = this.row(id)
    if (row === null) throw new Error("Запись истории не найдена")
    if (row.body_bytes > BODY_LIMIT) throw new Error("Тело записи превышает предел чтения 16 MiB; исходные данные сохранены")
    const content: Content[] = []
    for (const block of cachedQuery(this.db(), "SELECT data FROM block WHERE entry_id=? ORDER BY ordinal").iterate(id) as Iterable<{data: string}>) content.push(JSON.parse(block.data))
    return content
  }
  contentPage(id: string, query: HistoryContentQuery = {}): HistoryContentPage {
    const row = this.row(id)
    if (row === null || !["message", "context"].includes(row.kind)) throw new Error("Текстовая запись истории не найдена")
    const budget = queryLimit(query.maxBytes, 64 * 1024, 512 * 1024)
    const cursor = query.cursor ?? {block: 0, offset: 0}
    cursorValue(cursor.block); cursorValue(cursor.offset)
    const rows = cachedQuery(this.db(), "SELECT ordinal,bytes,json_extract(data,'$.type') AS type,json_type(data,'$.text') AS text_type,json_type(data,'$.resource.text') AS resource_text FROM block WHERE entry_id=? AND ordinal>=? ORDER BY ordinal LIMIT 64").all(id, cursor.block) as {ordinal: number; bytes: number; type: string; text_type: string | null; resource_text: string | null}[]
    const content: Content[] = []
    let bytes = 2
    let next: HistoryContentCursor | null = null
    for (const block of rows) {
      const offset = block.ordinal === cursor.block ? cursor.offset : 0
      if (block.type === "text" && block.text_type === "text" || block.type === "resource" && block.resource_text === "text") {
        const remaining = budget - bytes - 256
        if (remaining < 6) {if (!content.length) throw new RangeError("Бюджет слишком мал для текстовой порции"); next = {block: block.ordinal, offset}; break}
        const path = block.type === "text" ? "$.text" : "$.resource.text"
        const part = cachedQuery(this.db(), "SELECT substr(json_extract(data,?),?,?) AS text,length(json_extract(data,?)) AS length,json_extract(data,'$.resource.uri') AS uri,json_extract(data,'$.resource.mimeType') AS mime FROM block WHERE entry_id=? AND ordinal=?")
          .get(path, offset + 1, Math.max(1, Math.floor(remaining / 6)), path, id, block.ordinal) as {text: string; length: number; uri: string; mime: string | null}
        const value: Content = block.type === "text" ? {type: "text", text: part.text}
          : {type: "resource", resource: {uri: part.uri, text: part.text, ...(part.mime === null ? {} : {mimeType: part.mime})}}
        content.push(value)
        bytes += Buffer.byteLength(JSON.stringify(value)) + 1
        const end = offset + [...part.text].length
        if (end < part.length) {next = {block: block.ordinal, offset: end}; break}
      } else {
        if (offset !== 0) throw new TypeError("Смещение допустимо только для текста")
        if (bytes + block.bytes + 1 > budget) {
          if (!content.length) throw new Error("Нетекстовый блок превышает бюджет; используйте ссылку на оригинал")
          next = {block: block.ordinal, offset: 0}
          break
        }
        const stored = cachedQuery(this.db(), "SELECT data FROM block WHERE entry_id=? AND ordinal=?").get(id, block.ordinal) as {data: string}
        const value = projectMedia(JSON.parse(stored.data)) as Content
        content.push(value)
        bytes += Buffer.byteLength(JSON.stringify(value)) + 1
      }
      next = {block: block.ordinal + 1, offset: 0}
    }
    if (next !== null && cachedQuery(this.db(), "SELECT 1 FROM block WHERE entry_id=? AND ordinal>=? LIMIT 1").get(id, next.block) === null) next = null
    return {chatId: this.header.metadata.id, id, revision: row.revision, bytes, sourceBytes: row.body_bytes, content, next}
  }
  terminalPage(id: string, query: HistoryTerminalQuery = {}): HistoryTerminalPage {
    const row = this.row(id)
    if (row?.kind !== "tool") throw new Error("Инструмент истории не найден")
    const budget = queryLimit(query.maxBytes, 64 * 1024, 512 * 1024)
    const cursor = query.cursor ?? {ordinal: 0, offset: 0}
    cursorValue(cursor.ordinal); cursorValue(cursor.offset)
    const db = this.db()
    if (cursor.evidenceId !== undefined && (typeof cursor.evidenceId !== "string" || cursor.evidenceId.length > 512)) throw new TypeError("Недопустимый evidence id")
    const selection = cursor.evidenceId === undefined ? "entry_id=?" : "entry_id=? AND evidence_id=?"
    const parameters = cursor.evidenceId === undefined ? [id] : [id, cursor.evidenceId]
    const latest = cachedQuery(db, `SELECT terminal_id FROM terminal_event WHERE ${selection} ORDER BY ordinal DESC LIMIT 1`).get(...parameters) as {terminal_id: string | null} | null
    const info = cachedQuery(db, `SELECT cwd FROM terminal_event WHERE ${selection} AND cwd IS NOT NULL ORDER BY ordinal DESC LIMIT 1`).get(...parameters) as {cwd: string} | null
    const exit = cachedQuery(db, `SELECT exit_code,exit_signal FROM terminal_event WHERE ${selection} AND has_exit=1 ORDER BY ordinal DESC LIMIT 1`).get(...parameters) as {exit_code: number | null; exit_signal: string | null} | null
    const events = cachedQuery(db, `SELECT ordinal,sequence,evidence_id,stream FROM terminal_event WHERE ${selection} AND has_output=1 AND ordinal>=? ORDER BY ordinal LIMIT 64`).all(...parameters, cursor.ordinal) as {ordinal: number; sequence: number; evidence_id: string; stream: "stdout" | "stderr" | "combined"}[]
    const chunks: HistoryTerminalPage["chunks"][number][] = []
    let bytes = 2
    let next: HistoryTerminalPage["next"] = null
    for (const event of events) {
      const offset = event.ordinal === cursor.ordinal ? cursor.offset : 0
      const remaining = budget - bytes - 128
      if (remaining < 6) {if (!chunks.length) throw new RangeError("Бюджет слишком мал для вывода терминала"); next = {ordinal: event.ordinal, offset}; break}
      const fragment = cachedQuery(db, "SELECT substr(json_extract(data,'$.update._meta.terminal_output_delta.data'),?,?) AS text,length(json_extract(data,'$.update._meta.terminal_output_delta.data')) AS length FROM evidence WHERE id=? AND entry_id=?")
        .get(offset + 1, Math.floor(remaining / 6), event.evidence_id, id) as {text: string; length: number}
      const chunk = {sequence: event.sequence, stream: event.stream, text: fragment.text}
      chunks.push(chunk)
      bytes += Buffer.byteLength(JSON.stringify(chunk)) + 1
      const end = offset + [...fragment.text].length
      if (end < fragment.length) {next = {ordinal: event.ordinal, offset: end}; break}
      next = {ordinal: event.ordinal + 1, offset: 0}
    }
    if (next !== null && cachedQuery(db, `SELECT 1 FROM terminal_event WHERE ${selection} AND has_output=1 AND ordinal>=? LIMIT 1`).get(...parameters, next.ordinal) === null) next = null
    if (next !== null && cursor.evidenceId !== undefined) next = {...next, evidenceId: cursor.evidenceId}
    return {chatId: this.header.metadata.id, id, revision: row.revision, chunks, bytes, next,
      ...(latest?.terminal_id ? {terminalId: latest.terminal_id} : {}), ...(info ? {cwd: info.cwd} : {}),
      ...(exit ? {exit: {code: exit.exit_code, signal: exit.exit_signal}} : {})}
  }
  private terminalBody(id: string): {terminal?: HistoryTerminalPage} {
    return cachedQuery(this.db(), "SELECT 1 FROM terminal_event WHERE entry_id=? LIMIT 1").get(id) === null ? {} : {terminal: this.terminalPage(id)}
  }
  detailPage(id: string, query: {offset?: number; maxBytes?: number; evidenceId?: string} = {}): HistoryDetailPage {
    const row = this.row(id)
    if (row === null) throw new Error("Запись истории не найдена")
    const budget = queryLimit(query.maxBytes, 64 * 1024, 512 * 1024)
    cursorValue(query.offset)
    const offset = query.offset ?? 0
    if (query.evidenceId !== undefined && (typeof query.evidenceId !== "string" || query.evidenceId.length > 512)) throw new TypeError("Недопустимый evidence id")
    const value = (query.evidenceId === undefined
      ? cachedQuery(this.db(), "SELECT substr(data,?,?) AS text,length(data) AS length,length(CAST(data AS BLOB)) AS bytes FROM entry WHERE id=?")
        .get(offset + 1, Math.max(1, Math.floor(budget / 6)), id)
      : cachedQuery(this.db(), "SELECT substr(data,?,?) AS text,length(data) AS length,bytes FROM evidence WHERE entry_id=? AND id=?")
        .get(offset + 1, Math.max(1, Math.floor(budget / 6)), id, query.evidenceId)) as {text: string; length: number; bytes: number} | null
    if (value === null) throw new Error("Исходное свидетельство не найдено у записи")
    const end = offset + [...value.text].length
    return {chatId: this.header.metadata.id, id, revision: row.revision, text: value.text,
      bytes: Buffer.byteLength(value.text), sourceBytes: value.bytes, next: end < value.length ? end : null}
  }
  body(id: string): HistoryBody {
    const row = this.row(id)
    if (row === null) throw new Error("Запись истории не найдена")
    if ((row.kind === "message" || row.kind === "context") && row.body_bytes > 512 * 1024) {
      const page = this.contentPage(id)
      const data = JSON.parse((cachedQuery(this.db(), "SELECT data FROM entry WHERE id=?").get(id) as {data: string}).data)
      return {chatId: this.header.metadata.id, revision: row.revision, id, bytes: page.bytes,
        sourceBytes: page.sourceBytes, entry: {...data, content: page.content}, evidenceCount: row.evidence_count,
        ...(page.next === null ? {} : {continuation: page.next})}
    }
    if (row.kind === "tool" && row.body_bytes > 512 * 1024) {
      const detail = this.detailPage(id)
      const small = JSON.parse(row.preview)
      const entry: Item = {id, sequence: row.sequence, origin: row.origin, kind: "tool", toolCallId: row.tool_id!,
        call: {sessionUpdate: "tool_call_update", toolCallId: row.tool_id!, title: small.title, status: small.status}, updates: []}
      const terminal = this.terminalBody(id)
      return {chatId: this.header.metadata.id, id, revision: row.revision, bytes: detail.bytes + (terminal.terminal?.bytes ?? 0),
        sourceBytes: row.body_bytes, entry, detail, ...terminal, evidenceCount: row.evidence_count}
    }
    if (row.body_bytes > BODY_LIMIT) throw new Error("Тело записи превышает предел чтения 16 MiB; исходные данные сохранены")
    const data = JSON.parse((cachedQuery(this.db(), "SELECT data FROM entry WHERE id=?").get(id) as {data: string}).data)
    const context = this.replayContext(row)
    if (context !== null) {
      const entry: Item = {id: row.id, sequence: row.sequence, origin: row.origin,
        ...(data.batchId === undefined ? {} : {batchId: data.batchId}), kind: "context",
        ...(context.request_id === null ? {} : {requestId: context.request_id}), content: this.content(context.context_id)}
      return {chatId: this.header.metadata.id, revision: row.revision, id,
        bytes: context.body_bytes, entry, evidenceCount: row.evidence_count}
    }
    let entry: Item
    if (row.kind === "message" || row.kind === "context") {
      const content: Content[] = []
      let texts: string[] = []
      const flushTexts = () => { if (texts.length) { content.push({type: "text", text: texts.join("")}); texts = [] } }
      for (const block of this.content(id)) {
        if (block.type === "text" && typeof block.text === "string" && Object.keys(block).every(key => key === "type" || key === "text")) texts.push(block.text)
        else { flushTexts(); content.push(block) }
      }
      flushTexts()
      entry = {...data, content}
    } else entry = row.kind === "tool" ? {...data, updates: []} : data
    const terminal = row.kind === "tool" ? this.terminalBody(id) : {}
    return {chatId: this.header.metadata.id, revision: row.revision, id, bytes: row.body_bytes + (terminal.terminal?.bytes ?? 0), entry: projectMedia(entry) as Item, ...terminal, evidenceCount: row.evidence_count}
  }
  page(query: HistoryQuery = {}): HistoryPage {
    cursorValue(query.before); cursorValue(query.after); cursorValue(query.around)
    if ([query.before, query.after, query.around].filter(value => value !== undefined).length > 1) throw new TypeError("Укажите один cursor истории")
    const limit = queryLimit(query.limit, 32, 64)
    const maxBytes = queryLimit(query.maxBytes, 64 * 1024, 64 * 1024)
    let rows: Row[] = []
    if (this.initialized) {
      const db = this.db()
      if (query.after !== undefined) rows = cachedQuery(db, `SELECT ${SMALL_COLUMNS} FROM entry WHERE ordinal>? ORDER BY ordinal LIMIT ?`).all(query.after, limit) as Row[]
      else if (query.around !== undefined) rows = cachedQuery(db, `SELECT ${SMALL_COLUMNS} FROM entry WHERE ordinal>=? ORDER BY ordinal LIMIT ?`).all(Math.max(0, query.around - Math.floor(limit / 2)), limit) as Row[]
      else rows = cachedQuery(db, `SELECT ${SMALL_COLUMNS} FROM entry WHERE ordinal<? ORDER BY ordinal DESC LIMIT ?`).all(query.before ?? Number.MAX_SAFE_INTEGER, limit) as Row[]
    }
    const items: HistoryEntry[] = []
    let bytes = 2
    const backwards = query.after === undefined && query.around === undefined
    for (const row of rows) {
      const entry = this.projectedHeader(row)
      const length = Buffer.byteLength(JSON.stringify(entry)) + Number(items.length > 0)
      if (bytes + length > maxBytes && items.length === 0) throw new RangeError("Заголовок записи превышает byte budget страницы; исходная identity сохранена")
      if (bytes + length > maxBytes) break
      items.push(entry); bytes += length
    }
    if (backwards) items.reverse()
    const first = items[0]?.ordinal
    const last = items.at(-1)?.ordinal
    const hasBefore = this.initialized && first !== undefined && cachedQuery(this.db(), "SELECT 1 FROM entry WHERE ordinal<? LIMIT 1").get(first) !== null
    const hasAfter = this.initialized && last !== undefined && cachedQuery(this.db(), "SELECT 1 FROM entry WHERE ordinal>? LIMIT 1").get(last) !== null
    return {chatId: this.header.metadata.id, revision: this.header.history.revision, total: this.header.history.total, start: first ?? 0,
      items, before: hasBefore ? first! : null, after: hasAfter ? last! : null}
  }
  /** Число сообщений и целых групп не зависит от окна raw entries. */
  displayStats(): HistoryState {
    if (!this.initialized) return {...this.stats(), total: 0}
    const counts = cachedQuery(this.db(), "SELECT (SELECT COUNT(*) FROM display_message)+(SELECT COUNT(*) FROM service_group) AS total").get() as {total: number}
    return {...this.stats(), total: counts.total}
  }
  private groupHeader(value: Record<string, any>): HistoryGroup {
    return {id: value.id, kind: "group", origin: "local", ordinal: value.anchor, sequence: value.anchor,
      revision: value.revision, bodyBytes: 0, evidenceCount: value.count, memberCount: value.count,
      userId: value.user_id, lastSequence: value.last_sequence, title: "Действия агента",
      ...(value.status === null ? {} : {status: value.status}), ...(value.received_at === null ? {} : {receivedAt: value.received_at})}
  }
  private projectionRevision(expected?: number): number {
    cursorValue(expected)
    const row = this.initialized ? cachedQuery(this.db(), "SELECT value FROM stamp WHERE key='display-boundary'").get() as {value: string} | null : null
    const current = row === null ? 0 : Number(row.value)
    if (expected !== undefined && expected !== current) throw new Error("Проекция истории изменилась; обновите страницу")
    return current
  }
  display(query: HistoryQuery = {}): HistoryDisplayPage {
    const projectionRevision = this.projectionRevision(query.projectionRevision)
    cursorValue(query.before); cursorValue(query.after); cursorValue(query.around)
    if ([query.before, query.after, query.around].filter(value => value !== undefined).length > 1) throw new TypeError("Укажите один cursor истории")
    const limit = queryLimit(query.limit, 32, 64)
    const budget = queryLimit(query.maxBytes, 65536, 65536)
    const db = this.initialized ? this.db() : null
    const source = "(SELECT id,sequence AS anchor,0 AS grouped FROM display_message UNION ALL SELECT id,anchor,1 AS grouped FROM service_group)"
    const forward = query.after !== undefined || query.around !== undefined
    const where = query.after !== undefined ? "anchor>?" : query.around !== undefined ? "anchor>=?" : "anchor<?"
    const cursor = query.after ?? (query.around === undefined ? query.before ?? Number.MAX_SAFE_INTEGER : Math.max(0, query.around - Math.floor(limit / 2)))
    const rows = db?.query(`SELECT * FROM ${source} WHERE ${where} ORDER BY anchor ${forward ? "ASC" : "DESC"} LIMIT ?`).all(cursor, limit) as {id: string; anchor: number; grouped: number}[] | undefined
    const items: (HistoryEntry | HistoryGroup)[] = []
    let bytes = 2
    for (const row of rows ?? []) {
      const entry = row.grouped ? this.groupHeader(db!.query("SELECT * FROM service_group WHERE id=?").get(row.id) as Record<string, any>)
        : {...this.projectedHeader(this.row(row.id)!), ordinal: row.anchor}
      const size = Buffer.byteLength(JSON.stringify(entry)) + Number(items.length > 0)
      if (bytes + size > budget) {if (!items.length) throw new RangeError("Заголовок превышает бюджет страницы"); break}
      items.push(entry)
      bytes += size
    }
    if (!forward) items.reverse()
    const first = items[0]?.ordinal
    const last = items.at(-1)?.ordinal
    return {chatId: this.header.metadata.id, revision: this.stats().revision, total: this.displayStats().total,
      rawTotal: this.stats().total, projectionRevision, start: first ?? 0, items,
      before: first !== undefined && db!.query(`SELECT 1 FROM ${source} WHERE anchor<? LIMIT 1`).get(first) ? first : null,
      after: last !== undefined && db!.query(`SELECT 1 FROM ${source} WHERE anchor>? LIMIT 1`).get(last) ? last : null}
  }
  groupPage(groupId: string, query: HistoryQuery = {}): HistoryGroupPage {
    const projectionRevision = this.projectionRevision(query.projectionRevision)
    cursorValue(query.before); cursorValue(query.after); cursorValue(query.around)
    if ([query.before, query.after, query.around].filter(value => value !== undefined).length > 1) throw new TypeError("Укажите один cursor группы")
    const limit = queryLimit(query.limit, 32, 64)
    const budget = queryLimit(query.maxBytes, 65536, 65536)
    const group = cachedQuery(this.db(), "SELECT * FROM service_group WHERE id=?").get(groupId) as Record<string, any> | null
    if (group === null) throw new Error("Группа истории не найдена; обновите страницу")
    const backwards = query.before !== undefined
    const where = backwards ? "sequence<?" : "sequence>=?"
    const cursor = query.before ?? (query.after === undefined ? Math.max(0, (query.around ?? 0) - Math.floor(limit / 2)) : query.after + 1)
    const rows = cachedQuery(this.db(), `SELECT * FROM service_occurrence WHERE group_id=? AND ${where} ORDER BY sequence ${backwards ? "DESC" : "ASC"} LIMIT ?`).all(groupId, cursor, limit) as Record<string, any>[]
    const items: HistoryOccurrence[] = []
    let bytes = 2
    for (const occurrence of rows) {
      const row = this.row(occurrence.entry_id)!
      const evidence = occurrence.evidence_id === null ? null : cachedQuery(this.db(), "SELECT bytes FROM evidence WHERE id=?").get(occurrence.evidence_id) as {bytes: number} | null
      const entry: HistoryOccurrence = {...headerEntry({...row, preview: occurrence.preview, revision: occurrence.revision,
        body_bytes: evidence?.bytes ?? row.body_bytes}), id: occurrence.id, entryId: row.id, groupId,
        ordinal: occurrence.sequence, sequence: occurrence.sequence, evidenceCount: 0,
        ...(occurrence.evidence_id === null ? {} : {evidenceId: occurrence.evidence_id}),
        ...(occurrence.request_id === null ? {} : {requestId: occurrence.request_id}),
        ...(occurrence.received_at === null ? {} : {receivedAt: occurrence.received_at})}
      const size = Buffer.byteLength(JSON.stringify(entry)) + Number(items.length > 0)
      if (bytes + size > budget) {if (!items.length) throw new RangeError("Occurrence превышает бюджет страницы"); break}
      items.push(entry)
      bytes += size
    }
    if (backwards) items.reverse()
    const first = items[0]?.sequence
    const last = items.at(-1)?.sequence
    return {chatId: this.header.metadata.id, groupId, projectionRevision, revision: group.revision, total: group.count, start: first ?? 0, items,
      before: first !== undefined && cachedQuery(this.db(), "SELECT 1 FROM service_occurrence WHERE group_id=? AND sequence<? LIMIT 1").get(groupId, first) ? first : null,
      after: last !== undefined && cachedQuery(this.db(), "SELECT 1 FROM service_occurrence WHERE group_id=? AND sequence>? LIMIT 1").get(groupId, last) ? last : null}
  }
  groupBody(groupId: string, id: string): HistoryBody {
    const occurrence = cachedQuery(this.db(), "SELECT * FROM service_occurrence WHERE group_id=? AND id=?").get(groupId, id) as Record<string, any> | null
    if (occurrence === null) throw new Error("Occurrence группы не найден")
    if (occurrence.evidence_id === null) return {...this.body(occurrence.entry_id), id, revision: occurrence.revision}
    const stored = cachedQuery(this.db(), "SELECT bytes FROM evidence WHERE id=?").get(occurrence.evidence_id) as {bytes: number}
    const original = this.row(occurrence.entry_id)!
    if (original.kind === "tool" && stored.bytes > 512 * 1024) {
      const small = JSON.parse(occurrence.preview)
      const detail = this.detailPage(original.id, {evidenceId: occurrence.evidence_id})
      const terminal = cachedQuery(this.db(), "SELECT 1 FROM terminal_event WHERE entry_id=? AND evidence_id=?").get(original.id, occurrence.evidence_id) === null
        ? undefined : this.terminalPage(original.id, {cursor: {ordinal: 0, offset: 0, evidenceId: occurrence.evidence_id}})
      const entry: Item = {id, sequence: occurrence.sequence, origin: original.origin, kind: "tool", toolCallId: original.tool_id!,
        call: {sessionUpdate: "tool_call_update", toolCallId: original.tool_id!, title: small.title, status: small.status}, updates: []}
      return {chatId: this.header.metadata.id, id, revision: occurrence.revision, bytes: detail.bytes + (terminal?.bytes ?? 0),
        entry, detail, ...(terminal ? {terminal} : {}), sourceBytes: stored.bytes, evidenceCount: 0}
    }
    if (stored.bytes > BODY_LIMIT) throw new Error("Occurrence превышает предел чтения 16 MiB")
    const event = JSON.parse((cachedQuery(this.db(), "SELECT data FROM evidence WHERE id=?").get(occurrence.evidence_id) as {data: string}).data) as HistoryEvidence
    const row = this.row(occurrence.entry_id)!
    const update = event.update as Update
    const base = {id, sequence: event.sequence, origin: event.origin, ...(event.receivedAt === undefined ? {} : {receivedAt: event.receivedAt})}
    const entry: Item = row.kind === "tool" && (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update")
      ? {...base, kind: "tool", toolCallId: update.toolCallId, call: update, updates: []}
      : row.kind === "message" && "content" in update
        ? {...base, kind: "message", role: JSON.parse(row.preview).role, content: [update.content as Content]}
        : {...base, kind: "event", update}
    return {chatId: this.header.metadata.id, id, revision: occurrence.revision, bytes: stored.bytes, entry: projectMedia(entry) as Item, evidenceCount: 0}
  }
  evidence(id: string, query: {before?: number; after?: number; around?: number; limit?: number; maxBytes?: number} = {}): HistoryEvidencePage {
    cursorValue(query.before); cursorValue(query.after)
    if (query.before !== undefined && query.after !== undefined) throw new TypeError("Укажите один cursor evidence")
    const row = this.row(id)
    if (row === null) throw new Error("Запись истории не найдена")
    const limit = queryLimit(query.limit, 32, 64)
    const maxBytes = queryLimit(query.maxBytes, 128 * 1024, 128 * 1024)
    cursorValue(query.around)
    if ([query.before, query.after, query.around].filter(value => value !== undefined).length > 1) throw new TypeError("Укажите один cursor evidence")
    const rows = query.before !== undefined
      ? cachedQuery(this.db(), "SELECT ordinal,bytes FROM evidence WHERE entry_id=? AND ordinal<? ORDER BY ordinal DESC LIMIT ?").all(id, query.before, limit)
      : cachedQuery(this.db(), "SELECT ordinal,bytes FROM evidence WHERE entry_id=? AND ordinal>=? ORDER BY ordinal LIMIT ?").all(id, query.after !== undefined ? query.after + 1 : Math.max(0, (query.around ?? 0) - Math.floor(limit / 2)), limit)
    const items: HistoryEvidence[] = []
    let bytes = 0
    let first: number | undefined
    let last: number | undefined
    for (const value of rows as {ordinal: number; bytes: number}[]) {
      if (value.bytes > BODY_LIMIT) throw new Error("Evidence превышает предел чтения 16 MiB; исходное событие сохранено")
      if (bytes + value.bytes > maxBytes && items.length) break
      // Один большой event остаётся читаемым отдельной ограниченной страницей.
      const payload = cachedQuery(this.db(), "SELECT data FROM evidence WHERE entry_id=? AND ordinal=?").get(id, value.ordinal) as {data: string}
      items.push(JSON.parse(payload.data)); bytes += value.bytes; first ??= value.ordinal; last = value.ordinal
      if (bytes >= maxBytes) break
    }
    if (query.before !== undefined) {
      items.reverse()
      const latest = first
      first = last
      last = latest
    }
    return {chatId: this.header.metadata.id, id, revision: row.revision, total: row.evidence_count, start: first ?? 0,
      items, before: first !== undefined && first > 0 ? first : null,
      after: last !== undefined && last + 1 < row.evidence_count ? last : null}
  }
  async flush(): Promise<void> { await this.writing }
  async dispose(): Promise<void> { await this.flush(); this.closed = true; closeDatabase(this.cacheFile) }
  /** Используется только подготовкой новой версии корпуса, до публикации основного header. */
  sourceHeader(): Header { return structuredClone(this.header) }
}

function maximumSequence(item: Item): number {
  let sequence = item.sequence
  if (item.kind === "message" || item.kind === "tool") for (const event of item.updates ?? []) sequence = Math.max(sequence, event.sequence)
  return sequence
}
async function* journalLines(file: string, bytes: number): AsyncGenerator<string> {
  if (bytes === 0) return
  let buffered = ""
  for await (const chunk of createReadStream(file, {encoding: "utf8", end: bytes - 1, highWaterMark: 64 * 1024})) {
    buffered += chunk
    let newline: number
    while ((newline = buffered.indexOf("\n")) !== -1) {
      const value = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      if (Buffer.byteLength(value) > RECORD_LIMIT) throw new Error("Запись журнала превышает 64 MiB")
      if (!value.length) throw new Error("Пустая запись в подтверждённом журнале")
      yield value
    }
    if (Buffer.byteLength(buffered) > RECORD_LIMIT) throw new Error("Запись журнала превышает 64 MiB")
  }
  if (buffered.length) throw new Error("Подтверждённая запись журнала не завершена")
}

/** Потоковое чтение legacy JSON: RAM ограничена одной записью, а не всей timeline. */
class JsonReader {
  private iterator: AsyncIterator<string | Buffer>
  private buffer = ""
  private offset = 0
  constructor(file: string) { this.iterator = createReadStream(file, {encoding: "utf8", highWaterMark: 64 * 1024})[Symbol.asyncIterator]() }
  async peek(): Promise<string> {
    while (this.offset >= this.buffer.length) {
      const next = await this.iterator.next()
      if (next.done) return ""
      this.buffer = String(next.value); this.offset = 0
    }
    return this.buffer[this.offset]!
  }
  async take(): Promise<string> { const value = await this.peek(); if (value) this.offset += 1; return value }
  async whitespace(): Promise<void> { while (/\s/u.test(await this.peek()) && await this.peek() !== "") await this.take() }
  async expect(value: string): Promise<void> { await this.whitespace(); if (await this.take() !== value) throw new Error("Повреждён legacy JSON истории") }
  async value(): Promise<unknown> {
    await this.whitespace()
    let text = ""
    let depth = 0
    let string = false
    let escaped = false
    let started = false
    while (true) {
      const char = await this.peek()
      if (!char) { if (!started || depth || string) throw new Error("Legacy JSON истории обрезан"); break }
      if (started && !string && depth === 0 && /[:,}\]\s]/u.test(char)) break
      await this.take(); text += char; started = true
      if (string) {
        if (escaped) escaped = false
        else if (char === "\\") escaped = true
        else if (char === '"') string = false
      } else if (char === '"') string = true
      else if (char === "[" || char === "{") depth += 1
      else if (char === "]" || char === "}") depth -= 1
      if (text.length > RECORD_LIMIT) throw new Error("Одна legacy запись превышает 64 MiB; исходный JSON оставлен без изменений")
    }
    return JSON.parse(text)
  }
  async close(): Promise<void> { await this.iterator.return?.() }
}

/** Читает только metadata прежнего источника; не мигрирует и не изменяет его. */
export async function readArchiveMetadata(file: string, fallback: Partial<ArchiveMetadata> = {}): Promise<ArchiveMetadata | null> {
  if (!await stat(file).then(() => true, error => { if (error.code === "ENOENT") return false; throw error })) return null
  const reader = new JsonReader(file)
  const fields: Record<string, unknown> = {}
  try {
    await reader.expect("{")
    while (true) {
      await reader.whitespace()
      if (await reader.peek() === "}") { await reader.take(); break }
      const key = await reader.value()
      if (typeof key !== "string") throw new Error("Повреждён ключ истории")
      await reader.expect(":")
      if (key === "timeline" || key === "messages") {
        await reader.expect("[")
        while (true) {
          await reader.whitespace()
          if (await reader.peek() === "]") { await reader.take(); break }
          await reader.value()
          await reader.whitespace()
          if (await reader.peek() === ",") await reader.take()
          else if (await reader.peek() !== "]") throw new Error("Повреждён массив истории")
        }
      } else fields[key] = await reader.value()
      await reader.whitespace()
      if (await reader.peek() === ",") await reader.take()
      else if (await reader.peek() !== "}") throw new Error("Повреждён JSON истории")
    }
    if (fields.schemaVersion === 3) return fields.metadata as ArchiveMetadata
    if (fields.schemaVersion !== 1 && fields.schemaVersion !== 2 || typeof fields.id !== "string" || typeof fields.address !== "string") throw new Error("Повреждены метаданные истории")
    const {schemaVersion, ...rest} = fields
    return {...rest, executorId: fields.executorId ?? fallback.executorId ?? defaultExecutorId(fields.id), executorLabel: fields.executorLabel ?? "Основной",
      pending: schemaVersion === 1 ? [] : fields.pending ?? [], historyComplete: schemaVersion === 1 ? false : fields.historyComplete} as ArchiveMetadata
  } finally { await reader.close() }
}

/** Schema3 list/read: только малый header, без открытия SQLite и загрузки корпуса. */
export async function readArchiveState(file: string): Promise<Readonly<{metadata: ArchiveMetadata; history: HistoryState; displayHistory?: HistoryState}> | null> {
  const source = await stat(file).catch(error => { if (error.code === "ENOENT") return null; throw error })
  if (source === null) return null
  const reader = new JsonReader(file)
  let version: unknown
  try {
    await reader.expect("{")
    const name = await reader.value()
    await reader.expect(":")
    if (name === "schemaVersion") version = await reader.value()
  } finally { await reader.close() }
  if (version !== 3) return null
  if (source.size > 1024 * 1024) throw new Error("Заголовок дисковой истории превышает 1 MiB")
  const header = JSON.parse(await readFile(file, "utf8")) as Header
  if (header.schemaVersion !== 3 || typeof header.metadata?.id !== "string" || typeof header.metadata?.address !== "string" ||
    ![header.history?.revision, header.history?.total, header.history?.lastSequence].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Повреждён заголовок дисковой истории")
  }
  return {metadata: header.metadata, history: header.history, ...(header.displayHistory === undefined ? {} : {displayHistory: header.displayHistory})}
}

async function migrate(file: string, fallback: ArchiveMetadata, options: {cacheDirectory?: string}): Promise<Archive> {
  const initialSource = await stat(file)
  const temporary = `${file}.${randomUUID()}.migration.tmp`
  const prepared = new Archive(temporary, fallback, options.cacheDirectory)
  const reader = new JsonReader(file)
  const fields: Record<string, unknown> = {}
  let timelineSeen = false
  let messagesSeen = false
  let messageSequence = 0
  let firstUserLabel: string | undefined
  let published = false
  let renamedJournal: string | undefined
  try {
    await reader.expect("{")
    while (true) {
      await reader.whitespace()
      if (await reader.peek() === "}") { await reader.take(); break }
      const name = await reader.value()
      if (typeof name !== "string") throw new Error("Повреждён ключ legacy истории")
      await reader.expect(":")
      if (name === "timeline" || name === "messages") {
        if (name === "timeline") timelineSeen = true
        else messagesSeen = true
        await reader.expect("[")
        let batch: ArchiveMutation[] = []
        let batchBytes = 0
        while (true) {
          await reader.whitespace()
          if (await reader.peek() === "]") { await reader.take(); break }
          const value: any = await reader.value()
          const item: Item = name === "timeline" ? value : {id: value.id, sequence: ++messageSequence, origin: "legacy", kind: "message", role: value.role, content: [{type: "text", text: value.text}]}
          readHistory([item])
          if (firstUserLabel === undefined && item.kind === "message" && item.role === "user") {
            let short = ""
            for (const block of item.content) {
              if (block.type === "text") short += block.text.slice(0, 128 - short.length)
              if (short.length >= 128) break
            }
            firstUserLabel = short.trim().split(/\s+/u).slice(0, 6).join(" ").slice(0, 64) || "Вложение"
          }
          const bytes = Buffer.byteLength(JSON.stringify(item))
          if (batch.length && (batch.length >= 64 || batchBytes + bytes > 1024 * 1024)) { await prepared.commit(undefined, batch); batch = []; batchBytes = 0 }
          batch.push({type: "append", item}); batchBytes += bytes
          if (bytes > QUEUE_LIMIT) throw new Error("Одна legacy запись превышает 32 MiB; исходный JSON оставлен без изменений")
          await reader.whitespace()
          const separator = await reader.peek()
          if (separator === ",") await reader.take()
          else if (separator !== "]") throw new Error("Повреждена legacy timeline")
          if (separator === ",") { await reader.whitespace(); if (await reader.peek() === "]") throw new Error("Лишняя запятая в legacy timeline") }
        }
        if (batch.length) await prepared.commit(undefined, batch)
      } else fields[name] = await reader.value()
      await reader.whitespace()
      if (await reader.peek() === ",") { await reader.take(); await reader.whitespace(); if (await reader.peek() === "}") throw new Error("Лишняя запятая в legacy истории") }
      else if (await reader.peek() !== "}") throw new Error("Повреждена legacy история")
    }
    await reader.whitespace()
    if (await reader.peek() !== "") throw new Error("Лишние данные после legacy истории")
    if (fields.schemaVersion !== 1 && fields.schemaVersion !== 2 || fields.schemaVersion === 1 && (!messagesSeen || timelineSeen) || fields.schemaVersion === 2 && (!timelineSeen || messagesSeen) ||
      typeof fields.id !== "string" || typeof fields.address !== "string" || fallback.address !== undefined && fields.address !== fallback.address || !["idle", "connecting", "running", "failed"].includes(String(fields.status)) || !(fields.error === null || typeof fields.error === "string")) throw new Error("Повреждены метаданные legacy истории")
    const {schemaVersion, ...rest} = fields
    const metadata = {...rest, id: fields.id, address: fields.address,
      executorId: fields.executorId ?? fallback.executorId ?? defaultExecutorId(fields.id), executorLabel: fields.executorLabel ?? "Основной",
      pending: fields.schemaVersion === 1 ? [] : fields.pending ?? [], historyComplete: fields.schemaVersion === 1 ? false : fields.historyComplete} as ArchiveMetadata
    if (metadata.sessionLabel === undefined && firstUserLabel !== undefined) {
      metadata.sessionLabel = firstUserLabel
      metadata.sessionLabelSource = "auto"
      metadata.sessionLabelAssigned = true
    }
    if (!Array.isArray(metadata.pending) || typeof metadata.historyComplete !== "boolean") throw new Error("Повреждена очередь legacy истории")
    if (new Set(metadata.pending).size !== metadata.pending.length) throw new Error("Очередь legacy истории содержит повторные identity")
    for (const id of metadata.pending) if (typeof id !== "string" || !id.startsWith("user:") || prepared.lookup(id)?.role !== "user" || prepared.hasStarted(id.slice(5))) throw new Error("Очередь legacy истории не имеет ещё не начатого canonical message")
    const activeRequest = prepared.unfinishedRequest()
    if (activeRequest !== undefined) metadata.activeRequest = activeRequest
    await prepared.commit(metadata)
    let header = prepared.sourceHeader()
    await writeLease(file, async () => {
      const current = await stat(file)
      if (current.ino !== initialSource.ino || current.size !== initialSource.size || current.mtimeMs !== initialSource.mtimeMs || current.ctimeMs !== initialSource.ctimeMs) {
        const concurrent = await readArchiveState(file)
        if (concurrent === null || concurrent.metadata.id !== metadata.id || concurrent.metadata.address !== metadata.address) {
          throw new Error("Источник изменился во время миграции; повторите открытие истории")
        }
        // Другая миграция уже опубликована. Не заменяем её и возможные новые commits.
        header = JSON.parse(await readFile(file, "utf8")) as Header
        return
      }
      await link(file, `${file}.schema${schemaVersion}`).catch(error => { if (error.code !== "EEXIST") throw error })
      const journal = `${basename(file)}.journal.${randomUUID()}.ndjson`
      await rename(join(dirname(file), header.journal), join(dirname(file), journal))
      renamedJournal = journal
      header.journal = journal
      await atomicHeader(file, header)
      published = true
    })
    await prepared.dispose()
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error })
    const archive = new Archive(file, metadata, options.cacheDirectory, header)
    await archive.initialize()
    return archive
  } finally {
    await reader.close()
    await prepared.dispose()
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error })
    await unlink(prepared.cacheFile).catch(error => { if (error.code !== "ENOENT") throw error })
    if (!published) await unlink(join(dirname(file), renamedJournal ?? prepared.sourceHeader().journal)).catch(error => { if (error.code !== "ENOENT") throw error })
  }
}

export async function openArchive(file: string, fallback: ArchiveMetadata, options: {cacheDirectory?: string} = {}): Promise<Archive> {
  const exists = await stat(file).then(() => true, error => { if (error.code === "ENOENT") return false; throw error })
  if (!exists) return new Archive(file, fallback, options.cacheDirectory)
  // Schema находится в небольшом префиксе обычных JSON; для arbitrary field order reader раскрывает top-level keys без timeline allocation.
  const probe = new JsonReader(file)
  let version: unknown
  try {
    await probe.expect("{")
    const name = await probe.value()
    await probe.expect(":")
    if (name === "schemaVersion") version = await probe.value()
  } finally { await probe.close() }
  if (version !== 3) return migrate(file, fallback, options)
  const info = await stat(file)
  if (info.size > 1024 * 1024) throw new Error("Заголовок дисковой истории превышает 1 MiB")
  const header = JSON.parse(await readFile(file, "utf8")) as Header
  if (header.schemaVersion !== 3 || fallback.address !== undefined && header.metadata?.address !== fallback.address || typeof header.metadata?.id !== "string" ||
    typeof header.journal !== "string" || basename(header.journal) !== header.journal || !Number.isSafeInteger(header.committedBytes) || header.committedBytes < 0 ||
    typeof header.hash !== "string" || !/^[a-f0-9]{64}$/u.test(header.hash) ||
    ![header.history?.revision, header.history?.total, header.history?.lastSequence].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("Повреждён заголовок дисковой истории")
  const archive = new Archive(file, header.metadata, options.cacheDirectory, header)
  await archive.initialize()
  return archive
}

/** Копирует текстовый корпус без раскрытия истории и без перезаписи занятой цели. */
export async function copyArchive(sourceFile: string, destinationFile: string, metadata: ArchiveMetadata): Promise<void> {
  const paths = [resolve(sourceFile), resolve(destinationFile)].sort()
  if (paths[0] === paths[1]) throw new Error("Источник и назначение истории должны различаться")
  await writeLease(paths[0]!, async () => {
    await writeLease(paths[1]!, async () => { await copyArchiveLeased(sourceFile, destinationFile, metadata) })
  })
}
async function copyArchiveLeased(sourceFile: string, destinationFile: string, metadata: ArchiveMetadata): Promise<void> {
  const source = JSON.parse(await readFile(sourceFile, "utf8")) as Header
  if (source.schemaVersion !== 3) throw new Error("Перед переносом требуется миграция источника истории")
  await mkdir(dirname(destinationFile), {recursive: true})
  const journal = `${basename(destinationFile)}.journal.${randomUUID()}.ndjson`
  // Бинарные оригиналы принадлежат тому же owner meta/chat; перенос корпуса
  // публикуется только после переноса всех его references. Источник не меняется.
  const sourceMedia = createMediaStore(dirname(sourceFile))
  const destinationMedia = createMediaStore(dirname(destinationFile))
  if (resolve(dirname(sourceFile)) !== resolve(dirname(destinationFile))) {
    for await (const encoded of journalLines(join(dirname(sourceFile), source.journal), source.committedBytes)) {
      for (const reference of mediaReferences(JSON.parse(encoded))) {
        await destinationMedia.put(await sourceMedia.read(reference), reference)
      }
    }
  }
  await copyFile(join(dirname(sourceFile), source.journal), join(dirname(destinationFile), journal))
  const corpus = await open(join(dirname(destinationFile), journal), "r")
  try { await corpus.sync() } finally { await corpus.close() }
  const temporary = `${destinationFile}.${randomUUID()}.copy.tmp`
  const header = {...source, journal, metadata}
  let published = false
  try {
    await atomicHeader(temporary, header)
    await link(temporary, destinationFile)
    published = true
    const directory = await open(dirname(destinationFile), "r")
    try { await directory.sync() } finally { await directory.close() }
  } catch (error) {
    if (!published) await unlink(join(dirname(destinationFile), journal)).catch(() => {})
    throw error
  } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error }) }
}
