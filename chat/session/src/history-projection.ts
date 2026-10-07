/** Восстанавливаемая проекция сообщений и служебных occurrences; payload остаётся у Archive. */
import {query as cachedQuery} from "./queries"
import type {Database} from "bun:sqlite"

export function prepareProjection(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS display_message (id TEXT PRIMARY KEY, sequence INTEGER UNIQUE NOT NULL, role TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS display_user ON display_message(sequence) WHERE role='user';
    CREATE TABLE IF NOT EXISTS service_occurrence (id TEXT PRIMARY KEY, sequence INTEGER UNIQUE NOT NULL, entry_id TEXT NOT NULL,
      evidence_id TEXT, group_id TEXT NOT NULL, revision INTEGER NOT NULL, preview TEXT NOT NULL, request_id TEXT, received_at TEXT);
    CREATE INDEX IF NOT EXISTS service_group_order ON service_occurrence(group_id,sequence);
    CREATE INDEX IF NOT EXISTS service_entry ON service_occurrence(entry_id);
    CREATE TABLE IF NOT EXISTS service_group (id TEXT PRIMARY KEY, user_id TEXT, anchor INTEGER NOT NULL,
      last_sequence INTEGER NOT NULL, revision INTEGER NOT NULL, count INTEGER NOT NULL, status TEXT, received_at TEXT);
    CREATE INDEX IF NOT EXISTS service_anchor ON service_group(anchor);`)
}
export function clearProjection(db: Database): void {
  db.exec("DELETE FROM display_message; DELETE FROM service_occurrence; DELETE FROM service_group;")
}
function groupAt(db: Database, sequence: number): string {
  const user = cachedQuery(db, "SELECT id FROM display_message WHERE role='user' AND sequence<? ORDER BY sequence DESC LIMIT 1").get(sequence) as {id: string} | null
  return user === null ? "service:prelude" : `service:user:${user.id}`
}
function summarize(db: Database, id: string, revision: number): void {
  const aggregate = cachedQuery(db, "SELECT MIN(sequence) AS first,MAX(sequence) AS last,COUNT(*) AS count,MAX(received_at) AS received FROM service_occurrence WHERE group_id=?").get(id) as {first: number | null; last: number; count: number; received: string | null}
  if (aggregate.first === null) {cachedQuery(db, "DELETE FROM service_group WHERE id=?").run(id); return}
  const last = cachedQuery(db, "SELECT preview FROM service_occurrence WHERE group_id=? ORDER BY sequence DESC LIMIT 1").get(id) as {preview: string}
  const value = JSON.parse(last.preview)
  cachedQuery(db, "INSERT OR REPLACE INTO service_group(id,user_id,anchor,last_sequence,revision,count,status,received_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(id, id === "service:prelude" ? null : id.slice("service:user:".length), aggregate.first, aggregate.last, revision, aggregate.count, value.status ?? value.state ?? value.phase ?? null, aggregate.received)
}
/** Изменение user boundary переносит только затронутый интервал до следующего user. */
function boundaryChanged(db: Database, sequence: number, revision: number): void {
  cachedQuery(db, "INSERT OR REPLACE INTO stamp(key,value) VALUES('display-boundary',?)").run(String(revision))
  const next = cachedQuery(db, "SELECT sequence FROM display_message WHERE role='user' AND sequence>? ORDER BY sequence LIMIT 1").get(sequence) as {sequence: number} | null
  const end = next?.sequence ?? Number.MAX_SAFE_INTEGER
  const groups = cachedQuery(db, "SELECT DISTINCT group_id FROM service_occurrence WHERE sequence>=? AND sequence<?").all(sequence, end) as {group_id: string}[]
  const group = groupAt(db, sequence + 1)
  cachedQuery(db, "UPDATE service_occurrence SET group_id=?,revision=? WHERE sequence>=? AND sequence<?").run(group, revision, sequence, end)
  for (const id of new Set([...groups.map(row => row.group_id), group])) summarize(db, id, revision)
}
export function syncDisplayMessage(db: Database, id: string, revision: number): void {
  const row = cachedQuery(db, "SELECT sequence,kind,preview FROM entry WHERE id=?").get(id) as {sequence: number; kind: string; preview: string} | null
  const previous = cachedQuery(db, "SELECT sequence,role FROM display_message WHERE id=?").get(id) as {sequence: number; role: string} | null
  const preview = row === null ? {} : JSON.parse(row.preview)
  const projected = cachedQuery(db, "SELECT 1 FROM replay_projection WHERE entry_id=?").get(id) !== null
  const ordinary = row?.kind === "message" && ["user", "assistant"].includes(preview.role) && preview.purpose !== "command" && !projected
  if (ordinary) {
    cachedQuery(db, "INSERT OR REPLACE INTO display_message(id,sequence,role) VALUES(?,?,?)").run(id, row!.sequence, preview.role)
    if (preview.role === "user" && previous?.role !== "user") boundaryChanged(db, row!.sequence, revision)
  } else if (previous !== null) {
    cachedQuery(db, "DELETE FROM display_message WHERE id=?").run(id)
    if (previous.role === "user") boundaryChanged(db, previous.sequence, revision)
  }
}
export function removeOccurrences(db: Database, entryId: string, revision: number): void {
  const groups = cachedQuery(db, "SELECT DISTINCT group_id FROM service_occurrence WHERE entry_id=?").all(entryId) as {group_id: string}[]
  cachedQuery(db, "DELETE FROM service_occurrence WHERE entry_id=?").run(entryId)
  for (const row of groups) summarize(db, row.group_id, revision)
}
export function indexOccurrence(db: Database, input: {id: string; sequence: number; entryId: string; evidenceId?: string; revision: number; preview: string; requestId?: string; receivedAt?: string}): void {
  if (cachedQuery(db, "SELECT 1 FROM display_message WHERE id=?").get(input.entryId) !== null) return
  const groupId = groupAt(db, input.sequence)
  const changed = cachedQuery(db, "INSERT OR IGNORE INTO service_occurrence(id,sequence,entry_id,evidence_id,group_id,revision,preview,request_id,received_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(input.id, input.sequence, input.entryId, input.evidenceId ?? null, groupId, input.revision, input.preview, input.requestId ?? null, input.receivedAt ?? null)
  if (changed.changes) {
    const value = JSON.parse(input.preview)
    cachedQuery(db, `INSERT INTO service_group(id,user_id,anchor,last_sequence,revision,count,status,received_at) VALUES(?,?,?,?,?,1,?,?)
      ON CONFLICT(id) DO UPDATE SET anchor=MIN(anchor,excluded.anchor),last_sequence=MAX(last_sequence,excluded.last_sequence),
      revision=excluded.revision,count=count+1,status=COALESCE(excluded.status,status),received_at=COALESCE(excluded.received_at,received_at)`)
      .run(groupId, groupId === "service:prelude" ? null : groupId.slice("service:user:".length), input.sequence, input.sequence,
        input.revision, value.status ?? value.state ?? value.phase ?? null, input.receivedAt ?? null)
  }
}
