import {expect, test} from "bun:test"
import {createBrowserPreviewSession} from "../src/browser-preview-session"
import type {CapsuleRtcViewerOptions, CapsuleRtcViewerPeerConnectionLike} from "@capsule/webrtc/viewer"
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

test("ICE передаётся host callback при каждом новом peer, без fetch по origin Storybook", async () => {
  const descriptor = {instanceId: "instance-1", profile: "work", socketPath: "/api/browser/browser-viewer?ticket=private", controlEnabled: true}
  let viewerOptions!: CapsuleRtcViewerOptions
  let reads = 0
  const session = createBrowserPreviewSession({origin: "http://storybook", video: new Video(), open: async () => descriptor, onState() {},
    configuration: async (value, scope) => {
      expect(value).toBe(descriptor)
      scope.throwIfAborted()
      return {iceServers: [{urls: "turn:relay.example:3478", username: "u", credential: `c-${++reads}`}], iceTransportPolicy: "relay"}
    },
    viewerFactory: options => {viewerOptions = options; return {connect() {}, close() {}, sendControl() {return true}}},
  })
  await session.start()
  expect((await viewerOptions.loadIceConfiguration!("http://storybook/api/rtc/config")).iceServers[0]?.credential).toBe("c-1")
  expect((await viewerOptions.loadIceConfiguration!("http://storybook/api/rtc/config")).iceServers[0]?.credential).toBe("c-2")
  session.close()
  await expect(viewerOptions.loadIceConfiguration!("unused")).rejects.toThrow()
  expect(reads).toBe(2)
})


test("audio runtime предлагает один receive-only канал без захвата микрофона; video-only не меняется", async () => {
  for (const audio of [true, false]) {
    const f = fixture(async () => ({instanceId: "instance-1", profile: "work", socketPath: "/api/browser/browser-viewer?ticket=private", controlEnabled: true, audio}))
    await f.session.start()
    const offered: unknown[] = []
    const peer = {addTransceiver(kind: string, init: unknown) {offered.push({kind, init})}} as unknown as CapsuleRtcViewerPeerConnectionLike
    await f.callbacks().preparePeer?.(peer)
    expect(offered).toEqual(audio ? [{kind: "audio", init: {direction: "recvonly"}}] : [])
    expect(f.video.muted).toBeTrue()
    f.session.close()
  }
})

test("compiled viewer сохраняет host-owned MetaFor/Storybook route и отклоняет cross-origin, URL и peer injection", async () => {
  const {mkdtemp, rm} = await import("node:fs/promises")
  const {tmpdir} = await import("node:os")
  const {join} = await import("node:path")
  const {pathToFileURL} = await import("node:url")
  const directory = await mkdtemp(join(tmpdir(), "shared-browser-viewer-"))
  const originalSocket = globalThis.WebSocket
  const sockets: string[] = []
  try {
    const built = await Bun.build({entrypoints: [join(import.meta.dir, "../src/browser-preview-session.ts")], target: "bun", outdir: directory, packages: "bundle"})
    if (!built.success) throw new AggregateError(built.logs, "Shared browser session did not compile")
    const {createBrowserPreviewSession: create} = await import(pathToFileURL(join(directory, "browser-preview-session.js")).href) as typeof import("../src/browser-preview-session")
    globalThis.WebSocket = class {constructor(url: string | URL) {sockets.push(String(url))}} as unknown as typeof WebSocket
    const make = async (socketPath: string, origin = "http://storybook") => {
      let options!: CapsuleRtcViewerOptions
      const session = create({origin, video: new Video(), open: async () => ({instanceId: "instance-1", profile: "work", socketPath, controlEnabled: true}), onState() {},
        viewerFactory: value => {options = value; return {connect() {}, close() {}, sendControl() {return true}}}})
      await session.start()
      return {session, socket: (generated: string) => options.socketFactory!(generated)}
    }
    for (const [origin, path, expected] of [
      ["http://storybook", "/api/browser/browser-viewer?ticket=private", "ws://storybook/api/browser/browser-viewer?ticket=private&peer=viewer-1"],
      ["http://127.0.0.1:4444", "/agents/browser/socket?ticket=private&instanceId=instance-1", "ws://127.0.0.1:4444/agents/browser/socket?ticket=private&instanceId=instance-1&peer=viewer-1"],
      ["https://metafor.example", "/agents/browser/socket?ticket=private&instanceId=instance-1", "wss://metafor.example/agents/browser/socket?ticket=private&instanceId=instance-1&peer=viewer-1"],
    ]) {
      const f = await make(path!, origin)
      try {f.socket("ws://generated/rtc?peer=viewer-1"); expect(sockets.at(-1)).toBe(expected)} finally {f.session.close()}
    }
    for (const path of [
      "https://outsider.example/socket?ticket=private", "http://storybook/api/browser/browser-viewer?ticket=private", "//outsider.example/socket?ticket=private",
      "/\\outsider.example/socket?ticket=private", "/agents/browser/socket?ticket=private#fragment", "/agents/../socket?ticket=private",
      "/agents/browser/socket?ticket=private&peer=injected", "/agents/browser/socket?ticket=private&%70eer=injected",
      "/agents/browser/socket?ticket=private\n", "javascript:alert(1)",
    ]) {
      const f = await make(path)
      const before = sockets.length
      try {expect(() => f.socket("ws://generated/rtc?peer=viewer-1")).toThrow("Некорректный адрес viewer"); expect(sockets).toHaveLength(before)} finally {f.session.close()}
    }
    const f = await make("/agents/browser/socket?ticket=private&instanceId=instance-1")
    try {
      for (const generated of ["ws://generated/rtc", "ws://generated/rtc?peer=a&peer=b", "ws://generated/rtc?peer=viewer%26injected%3Dtrue"]) {
        expect(() => f.socket(generated)).toThrow("Некорректный адрес viewer")
      }
    } finally {f.session.close()}
  } finally {globalThis.WebSocket = originalSocket; await rm(directory, {recursive: true, force: true})}
})

test("active viewer renews the same descriptor sequentially without creating another RTC peer and close aborts an in-flight renewal", async () => {
  const descriptor = {instanceId: "instance-1", profile: "work", socketPath: "/agents/browser/socket?ticket=private&instanceId=instance-1", controlEnabled: true}
  let peers = 0, closes = 0, renews = 0, pending = 0, maximum = 0
  let renewalSignal: AbortSignal | undefined
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  const session = createBrowserPreviewSession({origin: "http://storybook", video: new Video(), open: async () => descriptor, onState() {}, renewalIntervalMs: 5,
    async renew(value, signal) {
      expect(value).toBe(descriptor)
      expect(signal.aborted).toBe(false)
      renewalSignal = signal
      renews++
      pending++
      maximum = Math.max(maximum, pending)
      try {
        if (renews === 2) {started.resolve(); await release.promise}
        else await Bun.sleep(15)
      } finally {pending--}
    },
    viewerFactory: () => {peers++; return {connect() {}, close() {closes++}, sendControl() {return true}}},
  })
  try {
    await session.start()
    await started.promise
    expect(renews).toBe(2)
    expect(peers).toBe(1)
    expect(maximum).toBe(1)
    session.close()
    expect(renewalSignal?.aborted).toBe(true)
    release.resolve()
    await Bun.sleep(25)
    expect(renews).toBe(2)
    expect(peers).toBe(1)
    expect(closes).toBe(1)
    expect(pending).toBe(0)
  } finally {release.resolve(); session.close()}
})

test("failed renewal fails closed once, stops its timer and requires a new manual viewer session", async () => {
  let peers = 0, closes = 0, renews = 0
  const states: Array<{status: string; error: string}> = []
  const session = createBrowserPreviewSession({origin: "http://storybook", video: new Video(),
    open: async () => ({instanceId: "instance-1", profile: "work", socketPath: "/agents/browser/socket?ticket=private&instanceId=instance-1", controlEnabled: true}),
    onState: state => states.push(state), renewalIntervalMs: 5,
    async renew() {renews++; throw new Error("Provider revoked the viewer")},
    viewerFactory: () => {peers++; return {connect() {}, close() {closes++}, sendControl() {return true}}},
  })
  try {
    await session.start()
    await Bun.sleep(30)
    expect(states.filter(state => state.status === "failed")).toEqual([expect.objectContaining({error: "Provider revoked the viewer"})])
    expect(closes).toBe(1)
    expect(renews).toBe(1)
    await session.start()
    await Bun.sleep(20)
    expect(renews).toBe(1)
    expect(peers).toBe(1)
  } finally {session.close()}
  expect(closes).toBe(1)
})

test("viewer without renewal capability preserves the previous lifecycle and closing before the timer sends no renewal", async () => {
  const without = fixture()
  await without.session.start()
  await Bun.sleep(15)
  expect(without.counts()).toEqual({started: 1, closed: 0, created: 1})
  without.session.close()
  let renews = 0
  const session = createBrowserPreviewSession({origin: "http://storybook", video: new Video(),
    open: async () => ({instanceId: "instance-1", profile: "work", socketPath: "/agents/browser/socket?ticket=private&instanceId=instance-1", controlEnabled: true}),
    onState() {}, renewalIntervalMs: 20, async renew() {renews++},
    viewerFactory: () => ({connect() {}, close() {}, sendControl() {return true}}),
  })
  await session.start()
  session.close()
  await Bun.sleep(30)
  expect(renews).toBe(0)
})

test("disconnected or terminal viewer stops renewal; recovery of the same RTC resumes only the existing grant", async () => {
  let callbacks!: CapsuleRtcViewerOptions
  let renews = 0, peers = 0
  const session = createBrowserPreviewSession({origin: "http://storybook", video: new Video(),
    open: async () => ({instanceId: "instance-1", profile: "work", socketPath: "/agents/browser/socket?ticket=private&instanceId=instance-1", controlEnabled: true}),
    onState() {}, renewalIntervalMs: 5, async renew() {renews++},
    viewerFactory: options => {callbacks = options; peers++; return {connect() {}, close() {}, sendControl() {return true}}},
  })
  const status = (value: "connected" | "disconnected" | "failed" | "closed") => callbacks.onState?.({status: value, controlStatus: "closed", instanceId: "instance-1", viewerPeerId: "viewer-1", signalingUrl: "unused"})
  try {
    await session.start()
    status("disconnected")
    await Bun.sleep(20)
    expect(renews).toBe(0)
    status("connected")
    await Bun.sleep(15)
    expect(renews).toBeGreaterThan(0)
    expect(peers).toBe(1)
    for (const terminal of ["failed", "closed"] as const) {
      status(terminal)
      const before = renews
      await Bun.sleep(20)
      expect(renews).toBe(before)
    }
  } finally {session.close()}
})

test("ended video track stops renewal even while RTC remains connected; a new live stream resumes the same viewer", async () => {
  let callbacks!: CapsuleRtcViewerOptions
  let mediaState!: (state: import("../src/browser-preview-session").BrowserPreviewState) => void
  let renews = 0, peers = 0
  const session = createBrowserPreviewSession({origin: "http://storybook", video: new Video(),
    open: async () => ({instanceId: "instance-1", profile: "work", socketPath: "/agents/browser/socket?ticket=private&instanceId=instance-1", controlEnabled: true}),
    onState() {}, renewalIntervalMs: 5, async renew() {renews++},
    mediaFactory: (_video, emit) => {mediaState = emit; return {async attach() {}, clear() {}, setMuted() {}}},
    viewerFactory: options => {callbacks = options; peers++; return {connect() {}, close() {}, sendControl() {return true}}},
  })
  const connected = () => callbacks.onState?.({status: "connected", controlStatus: "closed", instanceId: "instance-1", viewerPeerId: "viewer-1", signalingUrl: "unused"})
  try {
    await session.start()
    connected()
    mediaState({status: "connected", controlStatus: "closed", mediaStatus: "failed", width: 1000, height: 500, error: "Remote video track ended."})
    await Bun.sleep(20)
    connected()
    await Bun.sleep(20)
    expect(renews).toBe(0)
    mediaState({status: "connected", controlStatus: "closed", mediaStatus: "playing", width: 1000, height: 500, error: ""})
    await Bun.sleep(15)
    expect(renews).toBeGreaterThan(0)
    expect(peers).toBe(1)
  } finally {session.close()}
})
