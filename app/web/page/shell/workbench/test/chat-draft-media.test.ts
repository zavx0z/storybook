import {expect, test} from "bun:test"
import {filesToMedia} from "@zavx0z/chat/media"
import {loadDraftMedia, saveDraftMedia} from "../src/inspector/chat-draft-media"

/** Stateful IDB fixture: request success и transaction commit — разные события. */
function idbFixture() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB")
  const records = new Map<string, unknown>()
  const opens: (() => void)[] = []
  const reads: (() => void)[] = []
  const writes: (() => void)[] = []
  let holdOpen = false
  let holdRead = false
  let holdWrite = false
  let abortRead = false
  let closed = 0
  let aborted = 0
  let opened = 0
  type Request = {result?: unknown, error?: Error, onsuccess?: () => void, onerror?: () => void, onblocked?: () => void}
  const factory = {
    open() {
      opened++
      const database = {
        close() {closed++},
        onversionchange: null,
        objectStoreNames: {contains: () => true},
        transaction(_name: string, mode: string) {
          let stopped = false
          const transaction = {
            error: null as Error | null,
            oncomplete: undefined as (() => void) | undefined,
            onerror: undefined as (() => void) | undefined,
            onabort: undefined as (() => void) | undefined,
            abort() {if (!stopped) {stopped = true; aborted++; transaction.onabort?.()}},
            objectStore() {
              const request = (operation: "get" | "put" | "delete", id: string, value?: unknown) => {
                const result: Request = {}
                const run = () => {
                  if (stopped) return
                  result.result = operation === "get" ? records.get(id) : id
                  result.onsuccess?.()
                  queueMicrotask(() => {
                    if (stopped) return
                    if (operation === "get" && abortRead) {transaction.error = new Error("Read transaction aborted"); transaction.abort(); return}
                    if (operation === "put") records.set(id, value)
                    if (operation === "delete") records.delete(id)
                    transaction.oncomplete?.()
                  })
                }
                if (mode === "readwrite" && holdWrite) writes.push(run)
                else if (mode === "readonly" && holdRead) reads.push(run)
                else queueMicrotask(run)
                return result
              }
              return {get: (id: string) => request("get", id), put: (value: unknown, id: string) => request("put", id, value), delete: (id: string) => request("delete", id)}
            },
          }
          return transaction
        },
      }
      const request: Request = {result: database}
      const ready = () => request.onsuccess?.()
      if (holdOpen) opens.push(ready)
      else queueMicrotask(ready)
      return request
    },
  }
  Object.defineProperty(globalThis, "indexedDB", {configurable: true, value: factory})
  return {
    records,
    holdOpen() {holdOpen = true},
    holdRead() {holdRead = true},
    holdWrite() {holdWrite = true},
    abortRead() {abortRead = true},
    releaseOpen() {opens.splice(0).forEach(ready => ready())},
    releaseWrite() {writes.splice(0).forEach(ready => ready())},
    get opened() {return opened}, get closed() {return closed}, get aborted() {return aborted},
    dispose() {if (previous) Object.defineProperty(globalThis, "indexedDB", previous); else Reflect.deleteProperty(globalThis, "indexedDB")},
  }
}

const until = async (matches: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt++) {if (matches()) return; await Bun.sleep(0)}
  throw new Error("IDB fixture не достигла состояния")
}

test("IDB хранит Blob без data URL/base64, восстанавливает точные id и сериализует replace/delete", async () => {
  const f = idbFixture()
  const items = await filesToMedia([new File(["Текст"], "Текст.txt", {type: "text/plain"})], {})
  try {
    await saveDraftMedia("binary", items)
    const saved = f.records.get("binary") as {blob: Blob, id: string}[]
    expect(saved[0]!.blob).toBeInstanceOf(Blob)
    expect(await saved[0]!.blob.text()).toBe("Текст")
    expect(saved[0]).not.toHaveProperty("data")
    expect(saved[0]).not.toHaveProperty("previewUrl")
    const restored = await loadDraftMedia("binary", new AbortController().signal)
    expect(restored[0]!.attachment).toEqual(items[0]!.attachment)
    restored.forEach(item => item.release())
    await Promise.all([saveDraftMedia("binary", items), saveDraftMedia("binary", [])])
    expect(f.records.has("binary")).toBe(false)
    expect(f.closed).toBe(f.opened)
  } finally {items.forEach(item => item.release()); f.dispose()}
})

test("abort во время IDB open немедленно завершает read и закрывает поздно открывшийся database", async () => {
  const f = idbFixture()
  f.holdOpen()
  const controller = new AbortController()
  try {
    const load = loadDraftMedia("open", controller.signal).catch(error => error)
    await until(() => f.opened === 1)
    controller.abort()
    expect((await load).name).toBe("AbortError")
    f.releaseOpen()
    expect(f.closed).toBe(1)
  } finally {f.releaseOpen(); f.dispose()}
})

test("abort read transaction и abort после request success не возвращают неподтверждённые данные", async () => {
  const f = idbFixture()
  f.holdRead()
  const controller = new AbortController()
  try {
    const load = loadDraftMedia("read", controller.signal).catch(error => error)
    await until(() => f.opened === 1)
    await Bun.sleep(0)
    controller.abort()
    expect((await load).name).toBe("AbortError")
    expect(f.aborted).toBe(1)
    expect(f.closed).toBe(1)
  } finally {f.dispose()}
  const transaction = idbFixture()
  transaction.abortRead()
  try {await expect(loadDraftMedia("late-abort", new AbortController().signal)).rejects.toThrow("Read transaction aborted")}
  finally {transaction.dispose()}
})

test("отмена reader не ждёт и не отменяет уже начатую запись того же черновика", async () => {
  const f = idbFixture()
  f.holdWrite()
  const items = await filesToMedia([new File(["saved"], "saved.txt", {type: "text/plain"})], {})
  const save = saveDraftMedia("waiting", items)
  const controller = new AbortController()
  try {
    await until(() => f.opened === 1)
    await Bun.sleep(0)
    const load = loadDraftMedia("waiting", controller.signal).catch(error => error)
    controller.abort()
    expect((await load).name).toBe("AbortError")
    expect(f.aborted).toBe(0)
    f.releaseWrite()
    await save
    expect(f.records.has("waiting")).toBe(true)
  } finally {f.releaseWrite(); await save; items.forEach(item => item.release()); f.dispose()}
})
