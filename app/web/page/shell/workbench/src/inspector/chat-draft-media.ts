/** Черновые оригиналы остаются бинарными Blob в browser storage; URLs не сохраняются. */
import {mediaAttachmentBlob} from "@zavx0z/chat/content"
import {filesToMedia, type MediaDraftAttachment} from "@zavx0z/chat/media"

type Stored = Readonly<{id: string, name: string, mimeType: string, blob: Blob}>

function database(signal?: AbortSignal): Promise<IDBDatabase | null> {
  signal?.throwIfAborted()
  if (typeof indexedDB === "undefined") return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    let settled = false
    const request = indexedDB.open("storybook.chat.drafts", 1)
    const fail = (reason: unknown) => {
      if (settled) return
      settled = true
      signal?.removeEventListener("abort", abort)
      reject(reason)
    }
    const abort = () => fail(signal?.reason ?? new DOMException("Чтение черновика отменено", "AbortError"))
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("media")) request.result.createObjectStore("media")
    }
    request.onsuccess = () => {
      const db = request.result
      if (settled || signal?.aborted) {db.close(); abort(); return}
      settled = true
      signal?.removeEventListener("abort", abort)
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () => fail(request.error ?? new Error("Не удалось открыть хранилище вложений"))
    request.onblocked = () => fail(new Error("Хранилище вложений занято другой вкладкой"))
    signal?.addEventListener("abort", abort, {once: true})
    if (signal?.aborted) abort()
  })
}

function transact<T>(db: IDBDatabase, mode: IDBTransactionMode, signal: AbortSignal | undefined, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("media", mode)
    let value: T
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      signal?.removeEventListener("abort", abort)
      if (error !== undefined) reject(error)
      else resolve(value)
    }
    const abort = () => {
      try {transaction.abort()} catch {}
      finish(signal?.reason ?? new DOMException("Операция с черновиком отменена", "AbortError"))
    }
    transaction.oncomplete = () => finish()
    transaction.onerror = () => finish(transaction.error ?? new Error("Ошибка хранилища вложений"))
    transaction.onabort = () => finish(signal?.aborted ? signal.reason : transaction.error ?? new Error("Операция с черновиком отменена"))
    const request = action(transaction.objectStore("media"))
    request.onsuccess = () => {value = request.result}
    request.onerror = () => finish(request.error ?? new Error("Не удалось прочитать вложения"))
    signal?.addEventListener("abort", abort, {once: true})
    if (signal?.aborted) abort()
  })
}

const writes = new Map<string, Promise<void>>()
export async function saveDraftMedia(id: string, attachments: readonly MediaDraftAttachment[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const snapshot: Stored[] = attachments.map(item => ({id: item.attachment.id, name: item.attachment.name,
    mimeType: item.attachment.mimeType, blob: mediaAttachmentBlob(item.attachment)}))
  const operation = (writes.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const db = await database(signal)
    if (!db) return
    try {
      if (snapshot.length) await transact(db, "readwrite", signal, store => store.put(snapshot, id))
      else await transact(db, "readwrite", signal, store => store.delete(id))
    } finally {db.close()}
  })
  writes.set(id, operation)
  void operation.finally(() => {if (writes.get(id) === operation) writes.delete(id)}).catch(() => {})
  return operation
}

export async function loadDraftMedia(id: string, signal: AbortSignal): Promise<readonly MediaDraftAttachment[]> {
  signal.throwIfAborted()
  const writing = writes.get(id)
  if (writing) await new Promise<void>((resolve, reject) => {
    const abort = () => {signal.removeEventListener("abort", abort); reject(signal.reason)}
    const ready = () => {signal.removeEventListener("abort", abort); resolve()}
    signal.addEventListener("abort", abort, {once: true})
    void writing.then(ready, ready)
    if (signal.aborted) abort()
  })
  signal.throwIfAborted()
  const db = await database(signal)
  if (!db) return []
  let saved: Stored[]
  try {saved = await transact(db, "readonly", signal, store => store.get(id)) ?? []}
  finally {db.close()}
  signal.throwIfAborted()
  if (!Array.isArray(saved) || saved.length > 8 || new Set(saved.map(item => item?.id)).size !== saved.length ||
    saved.some(item => !item || !(item.blob instanceof Blob) || typeof item.id !== "string" || !item.id || item.id.length > 128 ||
      typeof item.name !== "string" || item.name.length > 512 || typeof item.mimeType !== "string" || item.mimeType.length > 256) ||
    saved.reduce((sum, item) => sum + item.blob.size, 0) > 8 * 1024 * 1024) throw new Error("Черновик вложений повреждён")
  const files = saved.map(item => new File([item.blob], item.name, {type: item.mimeType}))
  const loaded = await filesToMedia(files, {signal})
  if (signal.aborted) {
    for (const item of loaded) item.release()
    signal.throwIfAborted()
  }
  return loaded.map((item, index) => ({...item, attachment: {...item.attachment, id: saved[index]!.id}}))
}
