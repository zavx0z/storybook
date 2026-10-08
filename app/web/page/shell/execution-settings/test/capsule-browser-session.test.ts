import {expect, test} from "bun:test"
import {createBrowserPreviewSession} from "../src/browser-preview-session"
import type {CapsuleRtcViewerOptions} from "@capsule/webrtc/viewer"
import {parseInputCommand, type InputCommand} from "@capsule/input/protocol"

class Video extends EventTarget {
  autoplay = false
  defaultMuted = false
  muted = false
  playsInline = false
  paused = true
  readyState = 4
  currentTime = 0
  videoWidth = 1000
  videoHeight = 500
  srcObject: unknown = null
  async play() {this.paused = false}
  pause() {this.paused = true}
  getBoundingClientRect() {return {left: 0, top: 0, width: 200, height: 200, x: 0, y: 0, right: 200, bottom: 200, toJSON() {return {}}}}
}
function fixture(open = async (_signal: AbortSignal) => ({instanceId: "instance-1", profile: "work", socketPath: "/api/browser/browser-viewer?ticket=private", controlEnabled: true})) {
  const video = new Video()
  let callbacks!: CapsuleRtcViewerOptions
  let started = 0
  let closed = 0
  let created = 0
  const states: object[] = []
  const commands: InputCommand[] = []
  const session = createBrowserPreviewSession({video, origin: "http://storybook", open, onState: state => states.push(state),
    viewerFactory: options => {callbacks = options; created++; return {
      connect() {started++}, close() {closed++}, sendControl(value) {commands.push(value as InputCommand); return true},
    }},
  })
  const connected = () => callbacks.onState?.({status: "connected", controlStatus: "open", instanceId: "instance-1", viewerPeerId: "viewer-1", signalingUrl: "unused"})
  return {video, states, commands, session, connected, callbacks: () => callbacks, counts: () => ({started, closed, created})}
}
const pointer = (x = 100, y = 100) => ({clientX: x, clientY: y, button: 0, buttons: 1, detail: 1})
const key = (value: string) => ({key: value, code: `Key${value.toUpperCase()}`, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false, repeat: false})

test("viewer lazy, late descriptor после закрытия не создаёт viewer; отмена передаётся HTTP", async () => {
  const pending = Promise.withResolvers<{instanceId: string, profile: string, socketPath: string, controlEnabled: boolean}>()
  let requestSignal!: AbortSignal
  const f = fixture(async signal => {requestSignal = signal; return pending.promise})
  expect(f.counts().created).toBe(0)
  const opening = f.session.start()
  f.session.close()
  expect(requestSignal.aborted).toBeTrue()
  pending.resolve({instanceId: "late", profile: "work", socketPath: "/api/browser/browser-viewer?ticket=private", controlEnabled: true})
  await opening
  expect(f.counts()).toEqual({started: 0, closed: 0, created: 0})
  expect(f.video.srcObject).toBeNull()
})

test("MediaController назначает stream semantic video, muted по умолчанию, close освобождает медиа и viewer один раз", async () => {
  const f = fixture()
  await f.session.start()
  await f.session.start()
  f.connected()
  const stream = {getVideoTracks: () => []}
  f.callbacks().onStream?.(stream)
  await Bun.sleep(0)
  expect(f.video.srcObject).toBe(stream)
  expect(f.video.muted).toBeTrue()
  expect(f.video.playsInline).toBeTrue()
  f.session.mute(false)
  expect(f.video.muted).toBeFalse()
  f.session.close()
  f.session.close()
  expect(f.commands.at(-1)?.type).toBe("releaseAll")
  expect(f.video.srcObject).toBeNull()
  expect(f.video.paused).toBeTrue()
  expect(f.counts()).toEqual({started: 1, closed: 1, created: 1})
})

test("штатные helper сохраняют letterbox и калибруют таб в экран Capsule; move ограничен последним событием", async () => {
  const f = fixture()
  await f.session.start()
  f.connected()
  expect(f.session.pointer("pointerDown", pointer(100, 10))).toBeFalse()
  expect(f.commands).toHaveLength(0)
  f.callbacks().onControlMessage?.({type: "inputState", status: "ready", width: 1000, height: 800})
  expect(f.session.pointer("pointerDown", pointer())).toBeTrue()
  expect(f.commands[1]).toMatchObject({type: "pointerDown", x: 499.5, y: 549.5, frameW: 1000, frameH: 800, button: "left"})
  for (let i = 0; i < 20; i++) f.session.pointer("pointerMove", pointer(50 + i, 100))
  expect(f.commands.filter(command => command.type === "pointerMove")).toHaveLength(0)
  await Bun.sleep(40)
  expect(f.commands.filter(command => command.type === "pointerMove")).toHaveLength(1)
  f.session.close()
})

test("keyboard, IME text и clipboard используют protocol, выключение и blur отправляют releaseAll", async () => {
  const f = fixture()
  await f.session.start()
  f.connected()
  expect(f.session.key("keyDown", key("a"))).toBeFalse()
  expect(f.session.key("keyDown", {...key("Enter"), isComposing: true})).toBeFalse()
  expect(f.session.key("keyDown", {...key("v"), metaKey: true})).toBeFalse()
  expect(f.session.text("Привет 世界")).toBeTrue()
  expect(f.session.paste("clipboard")).toBeTrue()
  expect(f.session.key("keyDown", {...key("a"), metaKey: true})).toBeTrue()
  expect(f.session.key("keyUp", key("a"))).toBeTrue()
  expect(f.commands).toMatchObject([{type: "text", text: "Привет 世界"}, {type: "clipboardWrite", text: "clipboard", paste: true},
    {type: "keyDown", modifiers: ["control"]}, {type: "keyUp", modifiers: ["control"]}])
  f.session.release()
  expect(f.commands.at(-1)?.type).toBe("releaseAll")
  f.session.setControl(false)
  const count = f.commands.length
  expect(f.session.text("blocked")).toBeFalse()
  expect(f.session.pointer("pointerDown", pointer())).toBeFalse()
  expect(f.commands).toHaveLength(count)
  f.session.close()
})

test("клавиша без физического code сохраняет модификаторы и соответствует протоколу Capsule", async () => {
  const f = fixture()
  await f.session.start()
  f.connected()
  expect(f.session.key("keyDown", {...key("l"), code: "", ctrlKey: true})).toBeTrue()
  expect(f.session.key("keyUp", {...key("l"), code: "", ctrlKey: true})).toBeTrue()
  expect(f.commands.map(command => parseInputCommand(JSON.stringify(command)))).toMatchObject([
    {type: "keyDown", key: "l", modifiers: ["control"]},
    {type: "keyUp", key: "l", modifiers: ["control"]},
  ])
  expect(f.commands.every(command => !("code" in command))).toBeTrue()
  f.session.close()
})

test("media currentTime не перерисовывает UI, ошибки lifecycle показываются без повторного запуска", async () => {
  const f = fixture()
  await f.session.start()
  f.connected()
  const stream = {getVideoTracks: () => []}
  f.callbacks().onStream?.(stream)
  await Bun.sleep(0)
  f.video.dispatchEvent(new Event("loadedmetadata"))
  const count = f.states.length
  for (let i = 0; i < 20; i++) {f.video.currentTime = i; f.video.dispatchEvent(new Event("loadedmetadata"))}
  expect(f.states).toHaveLength(count)
  f.session.close()
  const failed = fixture(async () => {throw new Error("Профиль остановлен")})
  await failed.session.start()
  expect(failed.states.at(-1)).toMatchObject({status: "failed", error: "Профиль остановлен"})
  expect(failed.counts().created).toBe(0)
  failed.session.close()
})

test("порции text ограничены protocol и сохраняют UTF16 surrogate pair", async () => {
  const f = fixture()
  await f.session.start()
  f.connected()
  const text = "a".repeat(2047) + "😀" + "b".repeat(2047)
  expect(f.session.text(text)).toBeTrue()
  const chunks = f.commands.filter((value): value is Extract<InputCommand, {type: "text"}> => value.type === "text")
  expect(chunks.map(value => value.text).join("")).toBe(text)
  expect(chunks.every(value => value.text.length <= 2048)).toBeTrue()
  expect(chunks[0]!.text.length).toBe(2047)
  expect(chunks[1]!.text.startsWith("😀")).toBeTrue()
  f.session.close()
})

test("native window blur/pagehide/visibility освобождают клавиши; закрытие удаляет только свои lifecycle listeners", async () => {
  const lifecycle = new EventTarget()
  const document = Object.assign(new EventTarget(), {visibilityState: "visible"})
  const host = Object.assign(lifecycle, {document})
  let callbacks!: CapsuleRtcViewerOptions
  const commands: InputCommand[] = []
  let boundaries = 0
  const session = createBrowserPreviewSession({origin: "http://storybook", video: new Video(), lifecycle: host, onBoundary() {boundaries++}, onState() {},
    open: async () => ({instanceId: "instance-1", profile: "work", socketPath: "/api/browser/browser-viewer?ticket=private", controlEnabled: true}),
    viewerFactory: options => {callbacks = options; return {connect() {}, close() {}, sendControl(value) {commands.push(value as InputCommand); return true}}},
  })
  await session.start()
  callbacks.onState?.({status: "connected", controlStatus: "open", instanceId: "instance-1", viewerPeerId: "viewer-1", signalingUrl: "unused"})
  host.dispatchEvent(new Event("blur"))
  host.dispatchEvent(new Event("pagehide"))
  document.visibilityState = "hidden"
  document.dispatchEvent(new Event("visibilitychange"))
  expect(boundaries).toBe(3)
  expect(commands.map(value => value.type)).toEqual(["releaseAll", "releaseAll", "releaseAll"])
  session.close()
  const count = commands.length
  host.dispatchEvent(new Event("blur"))
  document.dispatchEvent(new Event("visibilitychange"))
  expect(boundaries).toBe(3)
  expect(commands).toHaveLength(count)
})


test("Chrome Studio video keeps the control DataChannel disabled", async () => {
  const f = fixture(async () => ({instanceId: "studio-instance", profile: "work", socketPath: "/api/browser/browser-viewer?ticket=private", controlEnabled: false}))
  await f.session.start()
  expect(f.callbacks().controlEnabled).toBe(false)
  f.callbacks().onState?.({status: "connected", controlStatus: "disabled", instanceId: "studio-instance", viewerPeerId: "viewer", signalingUrl: "unused"})
  expect(f.session.pointer("pointerDown", pointer())).toBe(false)
  expect(f.session.key("keyDown", key("a"))).toBe(false)
  f.session.close()
})
