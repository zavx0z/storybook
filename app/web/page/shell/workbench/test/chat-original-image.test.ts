import {expect, test} from "bun:test"
import {openChatOriginalImage} from "../src/inspector/chat-original-image"
import type {MediaPreview} from "@zavx0z/chat/content"

class TrackedTarget extends EventTarget {
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    super.addEventListener(type, listener, options)
    if (!listener) return
    let listeners = this.listeners.get(type)
    if (!listeners) this.listeners.set(type, listeners = new Set())
    listeners.add(listener)
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    super.removeEventListener(type, listener, options)
    if (listener) this.listeners.get(type)?.delete(listener)
  }
  get listenerCount() {return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0)}
}
class Image extends TrackedTarget {
  alt = ""
  src = ""
}
class ChildBlob extends Blob {}

function fixture() {
  const order: string[] = []
  const images: Image[] = []
  const created: Blob[] = []
  const revoked: string[] = []
  const tags: string[] = []
  let popups = 0
  let closes = 0
  let blocked = false
  const child = new TrackedTarget() as TrackedTarget & {document: unknown, opener: unknown, closed: boolean, close(): void, URL: unknown, Blob: typeof Blob}
  const reserved = {URL: "about:blank", title: "", defaultView: child,
    createElement(tag: string) {tags.push(tag); const image = new Image(); images.push(image); return image},
    body: {append() {}},
  }
  child.document = reserved
  child.opener = {parent: true}
  child.closed = false
  child.Blob = ChildBlob
  child.URL = {
    createObjectURL(blob: Blob) {created.push(blob); return `blob:child:${created.length}`},
    revokeObjectURL(url: string) {revoked.push(url)},
  }
  child.close = () => {closes++; child.closed = true; child.dispatchEvent(new Event("pagehide"))}
  const document = {defaultView: {open(url: string, target: string) {
    expect(url).toBe("about:blank")
    expect(target).toBe("_blank")
    order.push("open")
    popups++
    return blocked ? null : child
  }}} as unknown as Document
  const media: MediaPreview = {source: "chat-media:source", mimeType: "image/png", label: "Оригинал"}
  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], {type: "application/octet-stream"})
  return {document, media, blob, child, reserved, order, images, created, revoked, tags,
    get popups() {return popups}, get closes() {return closes},
    block() {blocked = true},
    async prepare() {await Bun.sleep(0)},
    ready() {images[0]!.dispatchEvent(new Event("load"))},
    fail() {images[0]!.dispatchEvent(new Event("error"))},
    navigate() {child.document = {URL: "https://example.test/elsewhere"}; child.dispatchEvent(new Event("pagehide"))},
  }
}

test("резервирование синхронно, child-owned Blob URL сохраняет raw bytes и после handoff не удерживает parent callbacks", async () => {
  const f = fixture()
  const controller = new AbortController()
  const opening = openChatOriginalImage(f.document, f.media, controller.signal, async () => {f.order.push("load"); return f.blob})
  expect(f.order).toEqual(["open", "load"])
  expect(f.popups).toBe(1)
  expect(f.child.opener).toBeNull()
  await f.prepare()
  expect(f.tags).toEqual(["img"])
  expect(f.created).toHaveLength(1)
  expect(f.created[0]).toBeInstanceOf(ChildBlob)
  expect(f.created[0]!.type).toBe("image/png")
  expect(await f.created[0]!.arrayBuffer()).toEqual(await f.blob.arrayBuffer())
  expect(f.images[0]!.src).toBe("blob:child:1")
  f.ready()
  await opening
  expect(f.child.listenerCount).toBe(0)
  expect(f.images[0]!.listenerCount).toBe(0)
  controller.abort()
  expect(f.revoked).toEqual([])
  expect(f.closes).toBe(0)
  f.navigate()
  expect(f.revoked).toEqual([])
  expect(f.closes).toBe(0)
})

test("popup blocked не читает original и не создаёт повторную вкладку", async () => {
  const f = fixture()
  f.block()
  let loads = 0
  await expect(openChatOriginalImage(f.document, f.media, new AbortController().signal, async () => {loads++; return f.blob})).rejects.toThrow("заблокировал")
  expect(loads).toBe(0)
  expect(f.popups).toBe(1)
  expect(f.created).toEqual([])
})

test("abort ожидающего native img освобождает один child URL и закрывает только свою blank вкладку", async () => {
  const f = fixture()
  const controller = new AbortController()
  const opening = openChatOriginalImage(f.document, f.media, controller.signal, async () => f.blob)
  await f.prepare()
  controller.abort()
  await expect(opening).rejects.toHaveProperty("name", "AbortError")
  expect(f.revoked).toEqual(["blob:child:1"])
  expect(f.closes).toBe(1)
  expect(f.child.listenerCount).toBe(0)
  expect(f.images[0]!.listenerCount).toBe(0)
})

test("переход пользователя во время transport отменяет подготовку, но не закрывает навигированную вкладку", async () => {
  const f = fixture()
  const gate = Promise.withResolvers<Blob>()
  let transport: AbortSignal | undefined
  const opening = openChatOriginalImage(f.document, f.media, new AbortController().signal, signal => {transport = signal; return gate.promise})
  f.navigate()
  expect(transport!.aborted).toBeTrue()
  gate.resolve(f.blob)
  await expect(opening).rejects.toHaveProperty("name", "AbortError")
  expect(f.closes).toBe(0)
  expect(f.created).toEqual([])
  expect(f.child.listenerCount).toBe(0)
})

test("same Document смена URL не считается принадлежащей host blank вкладкой", async () => {
  const f = fixture()
  const gate = Promise.withResolvers<Blob>()
  const opening = openChatOriginalImage(f.document, f.media, new AbortController().signal, () => gate.promise)
  f.reserved.URL = "about:blank#user-navigation"
  gate.resolve(f.blob)
  await expect(opening).rejects.toHaveProperty("name", "AbortError")
  expect(f.closes).toBe(0)
  expect(f.created).toEqual([])
})

test("native image error после user navigation отзывает URL, но не закрывает чужой Document", async () => {
  const f = fixture()
  const opening = openChatOriginalImage(f.document, f.media, new AbortController().signal, async () => f.blob)
  await f.prepare()
  f.navigate()
  f.fail()
  await expect(opening).rejects.toHaveProperty("name", "AbortError")
  expect(f.revoked).toEqual(["blob:child:1"])
  expect(f.closes).toBe(0)
  expect(f.images[0]!.listenerCount).toBe(0)
})

test.each(["image/svg+xml", "text/html"])("%s bytes передаются только img, никогда не становятся active Blob document", async mimeType => {
  const f = fixture()
  const source = new Blob(['<svg onload="alert(1)"></svg><script>payload</script>'], {type: mimeType})
  const opening = openChatOriginalImage(f.document, {...f.media, mimeType: "image/*"}, new AbortController().signal, async () => source)
  await f.prepare()
  expect(f.tags).toEqual(["img"])
  expect(f.reserved.URL).toBe("about:blank")
  expect(f.child.document).toBe(f.reserved)
  expect(f.created[0]!.type).toBe(source.type)
  f.fail()
  await expect(opening).rejects.toThrow("Не удалось открыть")
  expect(f.closes).toBe(1)
  expect(f.revoked).toEqual(["blob:child:1"])
})

test("16 МиБ original cap проверяется до child Blob URL и native img", async () => {
  const f = fixture()
  await expect(openChatOriginalImage(f.document, f.media, new AbortController().signal,
    async () => new Blob([new Uint8Array(16 * 1024 * 1024 + 1)]))).rejects.toThrow("16 МиБ")
  expect(f.created).toEqual([])
  expect(f.tags).toEqual([])
  expect(f.closes).toBe(1)
})

test("transport failure закрывает только ещё принадлежащую host blank вкладку", async () => {
  const f = fixture()
  await expect(openChatOriginalImage(f.document, f.media, new AbortController().signal,
    async () => {throw new Error("HTTP 404")})).rejects.toThrow("HTTP 404")
  expect(f.closes).toBe(1)
  expect(f.child.listenerCount).toBe(0)
})

test.each(["resolve", "reject"])("overlay abort закрывает blank вкладку сразу при игнорирующем signal loader; поздний %s не создаёт URL", async late => {
  const f = fixture()
  const gate = Promise.withResolvers<Blob>()
  const controller = new AbortController()
  let settled = false
  let failure: unknown
  const opening = openChatOriginalImage(f.document, f.media, controller.signal, () => gate.promise)
  void opening.then(() => {settled = true}, error => {settled = true; failure = error})
  try {
    controller.abort()
    await Bun.sleep(0)
    expect(f.closes, "Отмена не ожидает завершения original transport").toBe(1)
    expect(settled).toBeTrue()
    expect(failure).toHaveProperty("name", "AbortError")
    expect(f.created).toEqual([])
    expect(f.child.listenerCount).toBe(0)
  } finally {
    if (late === "resolve") gate.resolve(f.blob)
    else gate.reject(new Error("Поздний transport failure"))
    await opening.catch(() => {})
    await Bun.sleep(0)
  }
  expect(f.created).toEqual([])
  expect(f.closes).toBe(1)
})

test("навигация немедленно отменяет игнорирующий signal loader, не закрывая уже чужую вкладку", async () => {
  const f = fixture()
  const gate = Promise.withResolvers<Blob>()
  let settled = false
  const opening = openChatOriginalImage(f.document, f.media, new AbortController().signal, () => gate.promise)
  void opening.then(() => {settled = true}, () => {settled = true})
  try {
    f.navigate()
    await Bun.sleep(0)
    expect(settled).toBeTrue()
    expect(f.closes).toBe(0)
    expect(f.child.listenerCount).toBe(0)
    expect(f.created).toEqual([])
  } finally {
    gate.resolve(f.blob)
    await opening.catch(() => {})
    await Bun.sleep(0)
  }
  expect(f.closes).toBe(0)
  expect(f.created).toEqual([])
})
