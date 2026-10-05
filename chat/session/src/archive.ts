/**
Дисковая история беседы. Текстовый журнал в meta/chat является источником;
SQLite содержит только восстанавливаемую адресацию и проекции. Управляющее
состояние не удерживает записи, payload или полный индекс истории в памяти.
Replay собственного bootstrap с точным canonical user content раскрывается как
context; исходные ContentBlock, provider identity и evidence остаются на диске.
*/
import {Database} from "bun:sqlite"
import {createHash, randomUUID} from "node:crypto"
import {createReadStream, statSync} from "node:fs"
import {copyFile, link, mkdir, open, readFile, rename, stat, unlink} from "node:fs/promises"
import {basename, dirname, join, resolve} from "node:path"
import type {StorybookChatHistory} from "@zavx0z/storybook-chat-history"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"
import readHistory from "@zavx0z/storybook-chat-history"
import type {HistoryBody, HistoryEntry, HistoryEvidence, HistoryEvidencePage, HistoryPage, HistoryQuery, HistoryState} from "../contract/history"
import type {Document} from "./document"
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
  journal: string
  committedBytes: number
  hash: string
}
type Transaction = {schemaVersion: 1; previous: string; metadata: ArchiveMetadata; mutations: StoredMutation[]}
type Row = {id: string; ordinal: number; sequence: number; revision: number; kind: Item["kind"]; origin: Origin; preview: string; data?: string; body_bytes: number; evidence_count: number; provider_id: string | null; tool_id: string | null; replay_batch: string | null}
const SMALL_COLUMNS = "id,ordinal,sequence,revision,kind,origin,preview,body_bytes,evidence_count,provider_id,tool_id,replay_batch"
const BODY_LIMIT = 16 * 1024 * 1024
const CODEX_IMAGE_ECHO = "codex-image-echo-v1"
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
function codexImageEcho(content: readonly Content[]): string | null {
  if (!content.some(block => block.type === "image") || content.some(block => block.type !== "text" && block.type !== "image")) return null
  return content.map(block => {
    if (block.type === "text") return block.text
    if (block.type !== "image") throw new Error("Неподдерживаемый image echo block")
    let uri = `data:${block.mimeType};base64,${block.data}`
    if (block.uri) {
      try { if (["http:", "https:", "data:"].includes(new URL(block.uri).protocol)) uri = block.uri } catch {}
    }
    return `[@image](${uri})`
  }).join("")
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
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-2048; PRAGMA temp_store=FILE;
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
    CREATE TABLE IF NOT EXISTS replay_projection (entry_id TEXT PRIMARY KEY, context_id TEXT NOT NULL, request_id TEXT NOT NULL, body_bytes INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS replay_projection_context ON replay_projection(context_id);
    CREATE INDEX IF NOT EXISTS replay_projection_request ON replay_projection(request_id);`
  db.exec(replayIndexSchema)
  const keys = db.query("PRAGMA table_info(supplied_input)").all() as {pk: number}[]
  if (keys.filter(column => column.pk > 0).length === 1) {
    db.exec("DROP TABLE supplied_input; DROP TABLE replay_input; DELETE FROM replay_projection; DELETE FROM stamp;")
    db.exec(replayIndexSchema)
  }
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
    ...(data.status === undefined ? {} : {status: data.status}),
    ...(data.state === undefined ? {} : {state: data.state}),
    ...(data.stopReason === undefined ? {} : {stopReason: String(data.stopReason).slice(0, 1024)}),
    ...(data.error === undefined ? {} : {error: String(data.error).slice(0, 1024)}),
    bodyBytes: row.body_bytes, evidenceCount: row.evidence_count}
}
function preview(item: Record<string, any>): string {
  return JSON.stringify({
    ...(item.role === undefined ? {} : {role: item.role}),
    ...(item.purpose === undefined ? {} : {purpose: item.purpose}),
    ...(typeof item.call?.title === "string" ? {title: item.call.title.slice(0, 1024)} : {}),
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
  readonly cacheFile: string
  constructor(readonly file: string, metadata: ArchiveMetadata, cacheDirectory?: string, header?: Header) {
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
    return !this.initialized ? null : this.db().query(`SELECT ${SMALL_COLUMNS} FROM entry WHERE id=?`).get(id) as Row | null
  }
  lookup(id: string): HistoryEntry | null { const row = this.row(id); return row === null ? null : headerEntry(row) }
  findProvider(role: string, providerId: string): HistoryEntry | null {
    if (!this.initialized) return null
    const rows = this.db().query(`SELECT ${SMALL_COLUMNS} FROM entry WHERE provider_id=? ORDER BY ordinal LIMIT 1`).get(`${role}\0${providerId}`) as Row | null
    return rows === null ? null : headerEntry(rows)
  }
  findTool(toolCallId: string): HistoryEntry | null {
    if (!this.initialized) return null
    const row = this.db().query(`SELECT ${SMALL_COLUMNS} FROM entry WHERE tool_id=? ORDER BY ordinal LIMIT 1`).get(toolCallId) as Row | null
    return row === null ? null : headerEntry(row)
  }
  lastAssistant(afterSequence: number): HistoryEntry | null {
    if (!this.initialized) return null
    const row = this.db().query(`SELECT ${SMALL_COLUMNS} FROM entry WHERE kind='message' AND sequence>=? AND json_extract(preview,'$.role')='assistant' ORDER BY sequence DESC LIMIT 1`).get(afterSequence) as Row | null
    return row === null ? null : headerEntry(row)
  }
  unfinishedRequest(): string | undefined {
    if (!this.initialized) return undefined
    const started = this.db().query("SELECT json_extract(data,'$.requestId') AS request FROM entry WHERE kind='turn' AND json_extract(preview,'$.state')='started' ORDER BY ordinal DESC LIMIT 1").get() as {request: string} | null
    if (started === null) return undefined
    const completed = this.db().query("SELECT 1 FROM entry WHERE kind='turn' AND json_extract(data,'$.requestId')=? AND json_extract(preview,'$.state')!='started' LIMIT 1").get(started.request)
    return completed === null ? started.request : undefined
  }
  hasStarted(requestId: string): boolean {
    return this.initialized && this.db().query("SELECT 1 FROM entry WHERE kind='turn' AND json_extract(data,'$.requestId')=? AND json_extract(preview,'$.state')='started' LIMIT 1").get(requestId) !== null
  }
  private identity(db: Database, id: string, sequence: number, parent: string): void {
    // Первый raw event имеет sequence самой записи; остальные sequence глобально уникальны.
    db.query("INSERT INTO identity(id,sequence,entry_id) VALUES(?,?,?)").run(id, sequence, parent)
  }
  private addBlock(db: Database, id: string, content: Content): void {
    const encoded = JSON.stringify(content)
    db.query("INSERT INTO block(entry_id,ordinal,bytes,data) VALUES(?,(SELECT COALESCE(MAX(ordinal),-1)+1 FROM block WHERE entry_id=?),?,?)").run(id, id, Buffer.byteLength(encoded), encoded)
    db.query("UPDATE entry SET body_bytes=body_bytes+? WHERE id=?").run(Buffer.byteLength(encoded), id)
  }
  private addEvidence(db: Database, id: string, event: HistoryEvidence): void {
    const encoded = JSON.stringify(event)
    // Sequence совпадает только у entry и первого события; для identity сырого события сохраняется 0 в этом случае.
    const row = db.query("SELECT sequence FROM entry WHERE id=?").get(id) as {sequence: number}
    this.identity(db, event.id, event.sequence === row.sequence ? 0 : event.sequence, id)
    db.query("INSERT INTO evidence(entry_id,ordinal,id,sequence,bytes,data) VALUES(?,(SELECT COALESCE(MAX(ordinal),-1)+1 FROM evidence WHERE entry_id=?),?,?,?,?)").run(id, id, event.id, event.sequence, Buffer.byteLength(encoded), encoded)
    db.query("UPDATE entry SET evidence_count=evidence_count+1 WHERE id=?").run(id)
  }
  /** Digest читается по блокам: корпус и растущий список request не удерживаются в RAM. */
  private inputDigest(db: Database, ids: readonly string[]): string {
    const hash = createHash("sha256").update("[")
    let first = true
    for (const id of ids) for (const block of db.query("SELECT data FROM block WHERE entry_id=? ORDER BY ordinal").iterate(id) as Iterable<{data: string}>) {
      if (!first) hash.update(",")
      hash.update(contentEncoding(JSON.parse(block.data)))
      first = false
    }
    return hash.update("]").digest("hex")
  }
  private blocks(db: Database, id: string): Content[] {
    const row = db.query("SELECT body_bytes FROM entry WHERE id=?").get(id) as {body_bytes: number} | null
    if (row === null || row.body_bytes > BODY_LIMIT) throw new Error("Тело записи превышает предел ограниченного сопоставления")
    return (db.query("SELECT data FROM block WHERE entry_id=? ORDER BY ordinal").all(id) as {data: string}[]).map(block => JSON.parse(block.data))
  }
  private indexSuppliedInput(db: Database, item: Item, revision: number): void {
    if (item.kind === "turn" && item.state === "started") {
      const user = db.query("SELECT data,body_bytes FROM entry WHERE id=? AND kind='message' AND origin='local'").get(`user:${item.requestId}`) as {data: string; body_bytes: number} | null
      if (user !== null && user.body_bytes <= BODY_LIMIT) {
        const data = JSON.parse(user.data)
        this.indexSuppliedInput(db, {...data, content: this.blocks(db, data.id)}, revision)
      }
      return
    }
    if (item.kind === "message" && item.origin === "local" && item.role === "user" && item.id.startsWith("user:")) {
      const requestId = item.id.slice(5)
      const echo = codexImageEcho(item.content)
      const started = db.query("SELECT 1 FROM entry WHERE kind='turn' AND json_extract(preview,'$.state')='started' AND json_extract(data,'$.requestId')=? LIMIT 1").get(requestId) !== null
      if (started && echo !== null && Buffer.byteLength(echo) <= BODY_LIMIT) {
        const inputHash = digest(echo)
        db.query("INSERT OR REPLACE INTO supplied_input(context_id,request_id,bootstrap_hash,input_hash) VALUES(?,?,?,?)")
          .run(item.id, requestId, CODEX_IMAGE_ECHO, inputHash)
        for (const replay of db.query("SELECT entry_id FROM replay_input WHERE bootstrap_hash=? AND input_hash=?")
          .iterate(CODEX_IMAGE_ECHO, inputHash) as Iterable<{entry_id: string}>) this.materializeReplay(db, replay.entry_id, revision)
      }
      for (const context of db.query("SELECT data FROM entry WHERE kind='context' AND origin='local' AND json_extract(data,'$.requestId')=? AND body_bytes<=?")
        .iterate(requestId, BODY_LIMIT) as Iterable<{data: string}>) {
        const data = JSON.parse(context.data)
        this.indexSuppliedInput(db, {...data, content: this.blocks(db, data.id)}, revision)
      }
      return
    }
    if (item.kind !== "context" || item.origin !== "local" || !item.requestId || item.content.length !== 1 || item.content[0]?.type !== "text") return
    const userId = `user:${item.requestId}`
    const user = db.query("SELECT origin,kind,preview,body_bytes FROM entry WHERE id=?").get(userId) as Pick<Row, "origin" | "kind" | "preview" | "body_bytes"> | null
    if (user?.kind !== "message" || user.origin !== "local" || user.body_bytes > BODY_LIMIT || JSON.parse(user.preview).role !== "user") return
    if (Buffer.byteLength(JSON.stringify(item.content[0])) > BODY_LIMIT) return
    const bootstrapHash = digest(contentEncoding(item.content[0]))
    const inputHash = this.inputDigest(db, [item.id, userId])
    const fingerprints = [{bootstrapHash, inputHash}]
    const echo = codexImageEcho([...item.content, ...this.blocks(db, userId)])
    const started = db.query("SELECT 1 FROM entry WHERE kind='turn' AND json_extract(preview,'$.state')='started' AND json_extract(data,'$.requestId')=? LIMIT 1").get(item.requestId) !== null
    if (started && echo !== null && Buffer.byteLength(echo) <= BODY_LIMIT) fingerprints.push({bootstrapHash: CODEX_IMAGE_ECHO, inputHash: digest(echo)})
    for (const fingerprint of fingerprints) {
      db.query("INSERT OR REPLACE INTO supplied_input(context_id,request_id,bootstrap_hash,input_hash) VALUES(?,?,?,?)")
        .run(item.id, item.requestId, fingerprint.bootstrapHash, fingerprint.inputHash)
      for (const replay of db.query("SELECT entry_id FROM replay_input WHERE bootstrap_hash=? AND input_hash=?")
        .iterate(fingerprint.bootstrapHash, fingerprint.inputHash) as Iterable<{entry_id: string}>) this.materializeReplay(db, replay.entry_id, revision)
    }
  }
  /** Точное соответствие вычисляется при записи/rebuild; header чтение никогда не раскрывает payload. */
  private materializeReplay(db: Database, id: string, revision: number): void {
    const fingerprints = db.query("SELECT bootstrap_hash,input_hash FROM replay_input WHERE entry_id=? LIMIT 2").all(id) as {bootstrap_hash: string; input_hash: string}[]
    if (!fingerprints.length) return
    const previous = db.query("SELECT context_id FROM replay_projection WHERE entry_id=?").get(id) as {context_id: string} | null
    const matches: {context_id: string; request_id: string}[] = []
    let ambiguous = false
    for (const fingerprint of fingerprints) {
      const candidates = db.query("SELECT context_id,request_id FROM supplied_input WHERE bootstrap_hash=? AND input_hash=? LIMIT 2")
        .all(fingerprint.bootstrap_hash, fingerprint.input_hash) as {context_id: string; request_id: string}[]
      if (candidates.length > 1) { ambiguous = true; continue }
      const candidate = candidates[0]
      if (candidate === undefined) continue
      const replay = this.blocks(db, id)
      const supplied = this.blocks(db, candidate.context_id)
      const content = candidate.context_id === `user:${candidate.request_id}` ? supplied : [...supplied, ...this.blocks(db, `user:${candidate.request_id}`)]
      const confirmed = fingerprint.bootstrap_hash === CODEX_IMAGE_ECHO
        ? replay.every(block => block.type === "text") && replay.map(block => block.type === "text" ? block.text : "").join("") === codexImageEcho(content)
        : contentEncoding(replay) === contentEncoding(content)
      if (confirmed) matches.push(candidate)
    }
    const match = !ambiguous && matches.length === 1 ? matches[0] : undefined
    if (match === undefined) {
      if (previous !== null) {
        db.query("DELETE FROM replay_projection WHERE entry_id=?").run(id)
        db.query("UPDATE entry SET revision=? WHERE id=?").run(revision, id)
      }
      return
    }
    const context = db.query("SELECT body_bytes FROM entry WHERE id=?").get(match.context_id) as {body_bytes: number}
    db.query("INSERT OR REPLACE INTO replay_projection(entry_id,context_id,request_id,body_bytes) VALUES(?,?,?,?)")
      .run(id, match.context_id, match.request_id, context.body_bytes)
    db.query("UPDATE entry SET revision=? WHERE id=?").run(revision, id)
  }
  /** Только собственный envelope с native identity может стать кандидатом exact supplied replay. */
  private indexReplay(db: Database, id: string, revision: number): void {
    const row = db.query(`SELECT ${SMALL_COLUMNS} FROM entry WHERE id=?`).get(id) as Row | null
    if (row === null || row.kind !== "message" || row.origin !== "replay" || JSON.parse(row.preview).role !== "user") return
    db.query("DELETE FROM replay_input WHERE entry_id=?").run(id)
    db.query("DELETE FROM replay_projection WHERE entry_id=?").run(id)
    if (row.provider_id === null || row.body_bytes > BODY_LIMIT) return
    const first = db.query("SELECT data FROM block WHERE entry_id=? AND ordinal=0").get(id) as {data: string} | null
    if (first === null) return
    const block: Content = JSON.parse(first.data)
    if (block.type !== "text") return
    let envelope: unknown
    try { envelope = JSON.parse(block.text) } catch {}
    const environment = envelope !== null && typeof envelope === "object" && Object.keys(envelope).length === 1 && "environment" in envelope ? envelope.environment : undefined
    if (environment !== null && typeof environment === "object" && "executorId" in environment && environment.executorId === this.header.metadata.executorId &&
      "subject" in environment && environment.subject !== null && typeof environment.subject === "object" && "address" in environment.subject && environment.subject.address === this.header.metadata.address) {
      db.query("INSERT OR REPLACE INTO replay_input(entry_id,bootstrap_hash,input_hash) VALUES(?,?,?)")
        .run(id, digest(contentEncoding(block)), this.inputDigest(db, [id]))
    }
    const content = this.blocks(db, id)
    if (content.every(block => block.type === "text")) {
      const text = content.map(block => block.type === "text" ? block.text : "").join("")
      if (text.includes("[@image](")) db.query("INSERT OR REPLACE INTO replay_input(entry_id,bootstrap_hash,input_hash) VALUES(?,?,?)")
        .run(id, CODEX_IMAGE_ECHO, digest(text))
    }
    this.materializeReplay(db, id, revision)
  }
  private replayContext(row: Row): {context_id: string; request_id: string; body_bytes: number} | null {
    return this.db().query("SELECT context_id,request_id,body_bytes FROM replay_projection WHERE entry_id=?").get(row.id) as {context_id: string; request_id: string; body_bytes: number} | null
  }
  private projectedHeader(row: Row): HistoryEntry {
    const context = this.replayContext(row)
    return context === null ? headerEntry(row) : headerEntry({...row, kind: "context", preview: "{}", body_bytes: context.body_bytes})
  }
  private apply(db: Database, mutation: StoredMutation, revision: number): number {
    if (mutation.type === "create") {
      const update = mutation.event.update as Update
      const entry = mutation.entry
      const candidate = entry.kind === "message" && "content" in update
        ? {...entry, content: [update.content], updates: [mutation.event]}
        : {...entry, call: update, updates: [mutation.event]}
      const item = readHistory([candidate])[0]!
      const delta = this.apply(db, {type: "append", item}, revision)
      if (mutation.event.origin === "replay" && entry.kind === "message") db.query("UPDATE entry SET replay_batch=? WHERE id=?").run(mutation.event.batchId ?? null, String(entry.id))
      return delta
    }
    if (mutation.type === "remove") {
      db.query("DELETE FROM supplied_input WHERE context_id=? OR request_id=?").run(mutation.id, mutation.id.startsWith("user:") ? mutation.id.slice(5) : "")
      db.query("DELETE FROM replay_input WHERE entry_id=?").run(mutation.id)
      db.query("DELETE FROM replay_projection WHERE entry_id=? OR context_id=? OR request_id=?").run(mutation.id, mutation.id, mutation.id.startsWith("user:") ? mutation.id.slice(5) : "")
      db.query("DELETE FROM block WHERE entry_id=?").run(mutation.id)
      db.query("DELETE FROM evidence WHERE entry_id=?").run(mutation.id)
      db.query("DELETE FROM identity WHERE entry_id=?").run(mutation.id)
      const removed = db.query("DELETE FROM entry WHERE id=?").run(mutation.id)
      return -removed.changes
    }
    if (mutation.type === "purpose") {
      const row = db.query("SELECT * FROM entry WHERE id=?").get(mutation.id) as Row | null
      if (row === null || row.kind !== "message") throw new Error("Команда не имеет сохранённого сообщения")
      db.query("UPDATE entry SET data=?,preview=?,revision=? WHERE id=?").run(JSON.stringify({...JSON.parse(row.data!), purpose: "command"}), preview({...JSON.parse(row.preview), purpose: "command"}), revision, mutation.id)
      return 0
    }
    if (mutation.type === "append") {
      const item = mutation.item
      readHistory([item])
      const previous = db.query("SELECT sequence FROM entry ORDER BY ordinal DESC LIMIT 1").get() as {sequence: number} | null
      if (previous !== null && item.sequence <= previous.sequence) throw new Error("Нарушен первоначальный порядок timeline")
      const ordinal = (db.query("SELECT COALESCE(MAX(ordinal),-1)+1 AS ordinal FROM entry").get() as {ordinal: number}).ordinal
      const data = compactData(item)
      const encoded = JSON.stringify(data)
      this.identity(db, item.id, item.sequence, item.id)
      db.query("INSERT INTO entry(id,ordinal,sequence,revision,kind,origin,preview,data,body_bytes,provider_id,tool_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
        item.id, ordinal, item.sequence, revision, item.kind, item.origin, preview(item), encoded,
        item.kind === "tool" || item.kind === "event" ? Buffer.byteLength(encoded) : 0,
        item.kind === "message" && item.providerMessageId !== undefined ? `${item.role}\0${item.providerMessageId}` : null,
        item.kind === "tool" ? item.toolCallId : null)
      if (item.kind === "message" || item.kind === "context") for (const content of item.content) this.addBlock(db, item.id, content)
      if (item.kind === "tool" || item.kind === "message") for (const event of item.updates ?? []) this.addEvidence(db, item.id, event)
      this.indexSuppliedInput(db, item, revision)
      this.indexReplay(db, item.id, revision)
      return 1
    }
    const row = db.query("SELECT * FROM entry WHERE id=?").get(mutation.id) as Row | null
    if (row === null) throw new Error("Обновление не имеет сохранённой записи")
    const data = JSON.parse(row.data!)
    const update = mutation.event.update as Update
    if (row.kind === "message" && (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "user_message_chunk" || update.sessionUpdate === "agent_thought_chunk")) {
      if (mutation.reset) {
        db.query("DELETE FROM block WHERE entry_id=?").run(row.id)
        db.query("UPDATE entry SET body_bytes=0 WHERE id=?").run(row.id)
      }
      this.addBlock(db, row.id, update.content)
    } else if (row.kind === "tool" && (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update")) {
      data.call = mergeTool(data.call, update)
      const encoded = JSON.stringify(data)
      db.query("UPDATE entry SET data=?,preview=?,body_bytes=? WHERE id=?").run(encoded, preview(data), Buffer.byteLength(encoded), row.id)
    } else throw new Error("Обновление не соответствует виду записи")
    this.addEvidence(db, row.id, mutation.event)
    db.query("UPDATE entry SET revision=?,replay_batch=COALESCE(?,replay_batch) WHERE id=?").run(revision, mutation.replayBatch ?? null, row.id)
    this.indexReplay(db, row.id, revision)
    return 0
  }
  private stamp(db: Database, header: Header): void {
    db.query("INSERT OR REPLACE INTO stamp(key,value) VALUES('source',?)").run(this.sourceStamp(header))
  }
  private sourceStamp(header: Header): string {
    const info = statSync(join(dirname(this.file), header.journal))
    return `supplied-input-v6:${header.hash}:${header.committedBytes}:${info.mtimeMs}:${info.ctimeMs}:${info.size}`
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
    const saved = db.query("SELECT value FROM stamp WHERE key='source'").get() as {value: string} | null
    if (saved?.value === this.sourceStamp(this.header)) { this.initialized = true; return }
    db.exec("DELETE FROM stamp; DELETE FROM block; DELETE FROM evidence; DELETE FROM identity; DELETE FROM entry; DELETE FROM supplied_input; DELETE FROM replay_input; DELETE FROM replay_projection;")
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
    const total = (db.query("SELECT COUNT(*) AS total FROM entry").get() as {total: number}).total
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
      let sequence = this.header.history.lastSequence
      const stored = input.mutations.map((mutation: ArchiveMutation): StoredMutation => {
        if (mutation.type !== "append") return mutation
        const item = {...mutation.item, sequence: mutation.item.sequence ?? ++sequence} as Item
        sequence = Math.max(sequence, maximumSequence(item))
        return {type: "append", item}
      })
      await this.writeTransaction(input.metadata ?? this.header.metadata, stored)
    })
  }
  receive(update: Update, origin: "live" | "replay" | "local", cursor: ArchiveCursor): Promise<void> {
    return this.enqueue(JSON.stringify({update, origin}), async input => {
      const update = input.update as Update
      const sequence = this.header.history.lastSequence + 1
      const batchId = origin === "replay" ? cursor.batchId ??= randomUUID() : undefined
      const entry = {id: randomUUID(), sequence, origin, ...(batchId === undefined ? {} : {batchId})}
      const event: HistoryEvidence = {...entry, id: randomUUID(), update}
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
    const db = this.db()
    const encoded = JSON.stringify({schemaVersion: 1, previous: this.header.hash, metadata, mutations} satisfies Transaction)
    if (Buffer.byteLength(encoded) > RECORD_LIMIT) throw new Error("Одна транзакция истории превышает 64 MiB; источник не изменён")
    if (Buffer.byteLength(JSON.stringify(metadata)) > 512 * 1024) throw new Error("Метаданные истории превышают 512 KiB; источник не изменён")
    const revision = this.header.history.revision + 1
    db.exec("BEGIN")
    try {
      let total = this.header.history.total
      for (const mutation of mutations) total += this.apply(db, mutation, revision)
      const lastSequence = mutations.reduce((last, mutation) => Math.max(last, mutation.type === "append" ? maximumSequence(mutation.item) : mutation.type === "update" || mutation.type === "create" ? mutation.event.sequence : 0), this.header.history.lastSequence)
      const next: Header = {...this.header, metadata: structuredClone(metadata), history: {revision, total, lastSequence},
        committedBytes: this.header.committedBytes + Buffer.byteLength(encoded) + 1, hash: digest(this.header.hash + encoded)}
      // Во время disk await читатели видят только прежний подтверждённый индекс.
      db.exec("ROLLBACK")
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
        const confirmed = this.db()
        confirmed.transaction(() => {
          for (const mutation of mutations) this.apply(confirmed, mutation, revision)
          this.stamp(confirmed, next)
        })()
      } catch {
        this.initialized = false
        await this.initializeLeased()
      }
    } catch (error) {
      try { db.exec("ROLLBACK") } catch {}
      throw error
    }
  }
  content(id: string): Content[] {
    const row = this.row(id)
    if (row === null) throw new Error("Запись истории не найдена")
    if (row.body_bytes > BODY_LIMIT) throw new Error("Тело записи превышает предел чтения 16 MiB; исходные данные сохранены")
    const content: Content[] = []
    for (const block of this.db().query("SELECT data FROM block WHERE entry_id=? ORDER BY ordinal").iterate(id) as Iterable<{data: string}>) content.push(JSON.parse(block.data))
    return content
  }
  body(id: string): HistoryBody {
    const row = this.row(id)
    if (row === null) throw new Error("Запись истории не найдена")
    if (row.body_bytes > BODY_LIMIT) throw new Error("Тело записи превышает предел чтения 16 MiB; исходные данные сохранены")
    const data = JSON.parse((this.db().query("SELECT data FROM entry WHERE id=?").get(id) as {data: string}).data)
    const context = this.replayContext(row)
    if (context !== null) {
      const entry: Item = {id: row.id, sequence: row.sequence, origin: row.origin,
        ...(data.batchId === undefined ? {} : {batchId: data.batchId}), kind: "context", requestId: context.request_id, content: this.content(context.context_id)}
      return {chatId: this.header.metadata.id, revision: row.revision, id,
        bytes: context.body_bytes, entry, evidenceCount: row.evidence_count}
    }
    let entry: Item
    if (row.kind === "message" || row.kind === "context") {
      const content: Content[] = []
      let texts: string[] = []
      const flushTexts = () => { if (texts.length) { content.push({type: "text", text: texts.join("")}); texts = [] } }
      for (const block of this.content(id)) {
        if (block.type === "text" && Object.keys(block).every(key => key === "type" || key === "text")) texts.push(block.text)
        else { flushTexts(); content.push(block) }
      }
      flushTexts()
      entry = {...data, content}
    } else entry = row.kind === "tool" ? {...data, updates: []} : data
    return {chatId: this.header.metadata.id, revision: row.revision, id, bytes: row.body_bytes, entry, evidenceCount: row.evidence_count}
  }
  page(query: HistoryQuery = {}): HistoryPage {
    cursorValue(query.before); cursorValue(query.after); cursorValue(query.around)
    if ([query.before, query.after, query.around].filter(value => value !== undefined).length > 1) throw new TypeError("Укажите один cursor истории")
    const limit = queryLimit(query.limit, 32, 64)
    const maxBytes = queryLimit(query.maxBytes, 64 * 1024, 64 * 1024)
    let rows: Row[] = []
    if (this.initialized) {
      const db = this.db()
      if (query.after !== undefined) rows = db.query(`SELECT ${SMALL_COLUMNS} FROM entry WHERE ordinal>? ORDER BY ordinal LIMIT ?`).all(query.after, limit) as Row[]
      else if (query.around !== undefined) rows = db.query(`SELECT ${SMALL_COLUMNS} FROM entry WHERE ordinal>=? ORDER BY ordinal LIMIT ?`).all(Math.max(0, query.around - Math.floor(limit / 2)), limit) as Row[]
      else rows = db.query(`SELECT ${SMALL_COLUMNS} FROM entry WHERE ordinal<? ORDER BY ordinal DESC LIMIT ?`).all(query.before ?? Number.MAX_SAFE_INTEGER, limit) as Row[]
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
    const hasBefore = this.initialized && first !== undefined && this.db().query("SELECT 1 FROM entry WHERE ordinal<? LIMIT 1").get(first) !== null
    const hasAfter = this.initialized && last !== undefined && this.db().query("SELECT 1 FROM entry WHERE ordinal>? LIMIT 1").get(last) !== null
    return {chatId: this.header.metadata.id, revision: this.header.history.revision, total: this.header.history.total, start: first ?? 0,
      items, before: hasBefore ? first! : null, after: hasAfter ? last! : null}
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
      ? this.db().query("SELECT ordinal,bytes FROM evidence WHERE entry_id=? AND ordinal<? ORDER BY ordinal DESC LIMIT ?").all(id, query.before, limit)
      : this.db().query("SELECT ordinal,bytes FROM evidence WHERE entry_id=? AND ordinal>=? ORDER BY ordinal LIMIT ?").all(id, query.after !== undefined ? query.after + 1 : Math.max(0, (query.around ?? 0) - Math.floor(limit / 2)), limit)
    const items: HistoryEvidence[] = []
    let bytes = 0
    let first: number | undefined
    let last: number | undefined
    for (const value of rows as {ordinal: number; bytes: number}[]) {
      if (value.bytes > BODY_LIMIT) throw new Error("Evidence превышает предел чтения 16 MiB; исходное событие сохранено")
      if (bytes + value.bytes > maxBytes && items.length) break
      // Один большой event остаётся читаемым отдельной ограниченной страницей.
      const payload = this.db().query("SELECT data FROM evidence WHERE entry_id=? AND ordinal=?").get(id, value.ordinal) as {data: string}
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
export async function readArchiveState(file: string): Promise<Readonly<{metadata: ArchiveMetadata; history: HistoryState}> | null> {
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
  return {metadata: header.metadata, history: header.history}
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
