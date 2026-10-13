import {expect, test} from "bun:test"
import {createBrowserPreviewSession} from "../src/browser-preview-session"
import type {BrowserViewerDescriptor} from "../src/client"
import type {CapsuleRtcViewerOptions} from "@capsule/webrtc/viewer"
import type {CapsuleScreenshotCanvasLike} from "@capsule/screenshot/browser"

const descriptor: BrowserViewerDescriptor = {instanceId: "instance-1", profile: "assigned-profile", controlEnabled: true,
  socketPath: "/agents/browser/socket?ticket=grant-1&instanceId=instance-1",
  screenshotSocketPath: "/agents/browser/screenshot?ticket=grant-1&instanceId=instance-1&profile=assigned-profile"}
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz3UAAAAASUVORK5CYII=", "base64"))
const settle = async () => {for (let index = 0; index < 12; index++) await Promise.resolve()}
class Video extends EventTarget {
  autoplay = false
  defaultMuted = false
  muted = false
  playsInline = false
  paused = true
  readyState = 4
  currentTime = 0
  videoWidth = 1280
  videoHeight = 720
  srcObject: HTMLVideoElement["srcObject"] = null
  pauses = 0
  async play() {this.paused = false}
  pause() {this.paused = true; this.pauses++}
  getBoundingClientRect() {return {x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720, toJSON() {return {}}}}
}
class Socket extends EventTarget {
  readyState = 0
  bufferedAmount = 0
  closes = 0
  sent: Array<string | Uint8Array> = []
  send(value: string | Uint8Array) {this.sent.push(value)}
  open() {this.readyState = 1; this.dispatchEvent(new Event("open"))}
  close() {this.readyState = 3; this.closes++; this.dispatchEvent(new Event("close"))}
  request(requestId: string, instanceId = "instance-1") {
    this.dispatchEvent(new MessageEvent("message", {data: JSON.stringify({v: 1, type: "screenshot.request", requestId, instanceId, mimeType: "image/png", maxWidth: 640, maxHeight: 360})}))
  }
}
function fixture(selected: BrowserViewerDescriptor = descriptor, deferred = false) {
  const semantic = new Video(), native = new Video(), socket = new Socket(), states: unknown[] = [], draws: unknown[] = [], urls: string[] = []
  let callback: ((blob: Blob | null) => void) | undefined, decoders = 0, viewers = 0, viewerOptions!: CapsuleRtcViewerOptions
  const canvas: CapsuleScreenshotCanvasLike = {width: 0, height: 0, getContext() {return {drawImage(video) {draws.push(video)}}},
    toBlob(done, mimeType) {if (deferred) callback = done; else done(new Blob([Uint8Array.from(png).buffer], {type: mimeType}))}}
  const session = createBrowserPreviewSession({origin: "https://metafor.test", video: semantic, open: async () => selected, onState: state => states.push(state),
    viewerFactory: options => {viewers++; viewerOptions = options; return {connect() {}, close() {}, sendControl() {return true}}},
    screenshotVideoFactory: () => {decoders++; return native}, screenshotSocketFactory: url => {urls.push(url); return socket}, screenshotCanvasFactory: () => canvas})
  const stream = {getVideoTracks: () => []} as unknown as MediaStream
  return {session, semantic, native, socket, states, draws, urls, canvas, stream, counts: () => ({decoders, viewers}),
    attach() {viewerOptions.onStream?.(stream)}, finish() {callback?.(new Blob([Uint8Array.from(png).buffer], {type: "image/png"}))}}
}

test("explicit PNG grant reuses one RTC stream and encodes through the real public Capsule screenshot provider", async () => {
  const f = fixture()
  try {
    await f.session.start()
    expect(f.counts()).toEqual({decoders: 1, viewers: 1})
    expect(f.urls).toEqual(["wss://metafor.test/agents/browser/screenshot?ticket=grant-1&instanceId=instance-1&profile=assigned-profile"])
    f.socket.open()
    expect(JSON.parse(String(f.socket.sent[0]))).toMatchObject({type: "screenshot.provider.register", instanceId: "instance-1", supportedMimeTypes: ["image/png", "image/jpeg"]})
    f.attach()
    await settle()
    expect(f.native.srcObject).toBe(f.stream)
    expect(f.semantic.srcObject).toBe(f.stream)
    expect(f.native).toMatchObject({autoplay: true, muted: true, playsInline: true})
    f.socket.request("foreign", "another-instance")
    await settle()
    expect(JSON.parse(String(f.socket.sent.at(-1)))).toMatchObject({type: "screenshot.error", requestId: "foreign", errorCode: "invalid-request"})
    expect(f.draws).toEqual([])
    f.socket.request("owner-profile-save-1")
    await settle()
    expect(f.draws).toEqual([f.native])
    expect(f.canvas).toMatchObject({width: 640, height: 360})
    expect(JSON.parse(String(f.socket.sent.at(-2)))).toMatchObject({type: "screenshot.result", requestId: "owner-profile-save-1", instanceId: "instance-1", mimeType: "image/png", width: 640, height: 360, byteLength: png.length})
    expect(f.socket.sent.at(-1)).toEqual(png)
  } finally {f.session.close()}
  expect(f.native.srcObject).toBeNull()
  expect(f.native.paused).toBe(true)
  expect(f.socket.closes).toBe(1)
})

test("absent PNG capability creates neither capture decoder nor screenshot socket", async () => {
  const {screenshotSocketPath: _screenshot, ...plain} = descriptor
  const f = fixture(plain)
  try {
    await f.session.start()
    f.attach()
    await settle()
    expect(f.counts()).toEqual({decoders: 0, viewers: 1})
    expect(f.urls).toEqual([])
    expect(f.draws).toEqual([])
    expect(f.semantic.srcObject).toBe(f.stream)
  } finally {f.session.close()}
  expect(f.native.pauses).toBe(0)
})

test("closing an in-flight PNG encoding suppresses late bytes and releases only its own decoder/socket", async () => {
  const f = fixture(descriptor, true)
  await f.session.start()
  f.socket.open()
  f.attach()
  await settle()
  f.socket.request("pending-save")
  await settle()
  expect(f.draws).toEqual([f.native])
  const sent = f.socket.sent.length
  f.session.close()
  f.session.close()
  f.finish()
  f.attach()
  await settle()
  expect(f.socket.sent).toHaveLength(sent)
  expect(f.socket.closes).toBe(1)
  expect(f.native.pauses).toBe(1)
  expect(f.native.srcObject).toBeNull()
  expect(f.semantic.srcObject).toBeNull()
})

test("PNG endpoint rejects origin, grant, instance and profile substitution before creating any resource", async () => {
  for (const path of [
    "https://foreign.test/agents/browser/screenshot?ticket=grant-1&instanceId=instance-1&profile=assigned-profile",
    "//foreign.test/agents/browser/screenshot?ticket=grant-1&instanceId=instance-1&profile=assigned-profile",
    "/agents/browser/screenshot?ticket=foreign&instanceId=instance-1&profile=assigned-profile",
    "/agents/browser/screenshot?ticket=grant-1&instanceId=foreign&profile=assigned-profile",
    "/agents/browser/screenshot?ticket=grant-1&instanceId=instance-1&profile=foreign",
    descriptor.screenshotSocketPath! + "&ticket=duplicate",
    descriptor.screenshotSocketPath! + "#fragment",
    "/agents/../screenshot?ticket=grant-1&instanceId=instance-1&profile=assigned-profile",
  ]) {
    const f = fixture({...descriptor, screenshotSocketPath: path})
    try {
      await f.session.start()
      expect(f.states.at(-1)).toMatchObject({status: "failed", error: "Некорректный адрес PNG provider"})
      expect(f.counts()).toEqual({decoders: 0, viewers: 0})
      expect(f.urls).toEqual([])
    } finally {f.session.close()}
  }
})
