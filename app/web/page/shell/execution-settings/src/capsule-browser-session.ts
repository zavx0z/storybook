import {CapsuleRtcViewer, type CapsuleRtcViewerOptions, type CapsuleRtcViewerSnapshot} from "@capsule/webrtc/viewer"
import {CapsuleRtcMediaController, type CapsuleRtcVideoElementLike, type CapsuleRtcMediaStreamLike} from "@capsule/webrtc/media"
import {remotePoint} from "@capsule/webrtc/input"
import {mapCapturedPointerCommand, type CapsuleRemoteInputScreen} from "@capsule/webrtc/preview"
import type {InputCommand, InputButton, InputModifier} from "@capsule/input/protocol"
import type {CapsuleViewerDescriptor} from "./client"

type Video = CapsuleRtcVideoElementLike & Pick<HTMLVideoElement, "getBoundingClientRect">
type Viewer = Pick<CapsuleRtcViewer, "connect" | "close" | "sendControl">
type Lifecycle = Readonly<{
  addEventListener(type: "blur" | "pagehide", listener: () => void): void
  removeEventListener(type: "blur" | "pagehide", listener: () => void): void
  document: Readonly<{
    visibilityState: string
    addEventListener(type: "visibilitychange", listener: () => void): void
    removeEventListener(type: "visibilitychange", listener: () => void): void
  }>
}>
type Media = Pick<CapsuleRtcMediaController, "attach" | "clear" | "setMuted">
export type CapsuleBrowserState = Readonly<{status: string, controlStatus: string, mediaStatus: string, width: number, height: number, error: string}>
export const idleCapsuleBrowser: CapsuleBrowserState = {status: "idle", controlStatus: "closed", mediaStatus: "idle", width: 0, height: 0, error: ""}

/** Только semantic события, нормализованные штатными helper Capsule; lifecycle остаётся у viewer/media. */
export function createCapsuleBrowserSession(options: Readonly<{
  origin: string
  video: Video
  open(signal: AbortSignal): Promise<CapsuleViewerDescriptor>
  onState(state: CapsuleBrowserState): void
  lifecycle?: Lifecycle | undefined
  onBoundary?: (() => void) | undefined
  viewerFactory?: (options: CapsuleRtcViewerOptions) => Viewer
  mediaFactory?: (video: Video, onState: (state: CapsuleBrowserState) => void) => Media
}>) {
  const controller = new AbortController()
  let viewer: Viewer | undefined
  let state = idleCapsuleBrowser
  let mediaError = ""
  let viewerError = ""
  let closed = false
  let started = false
  let control = true
  let screen: CapsuleRemoteInputScreen | undefined
  let serial = 0
  let move: InputCommand | undefined
  let moveTimer: ReturnType<typeof setTimeout> | undefined
  const keys = new Map<string, Extract<InputCommand, {type: "keyDown" | "keyUp"}>>()
  const emit = (next: CapsuleBrowserState) => {
    if (closed || JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    options.onState(state)
  }
  const media = options.mediaFactory?.(options.video, emit) ?? new CapsuleRtcMediaController(options.video, {
    onState: snapshot => {
      mediaError = snapshot.error ?? ""
      emit({...state, mediaStatus: snapshot.status, width: snapshot.videoWidth, height: snapshot.videoHeight, error: mediaError || viewerError})
    },
  })
  const base = () => ({v: 1 as const, id: `storybook-${++serial}`})
  const send = (command: InputCommand, force = false): boolean => {
    if (closed || !viewer || !force && (!control || state.controlStatus !== "open")) return false
    const value = screen ? mapCapturedPointerCommand(command, options.video.videoWidth, options.video.videoHeight, screen) : command
    return viewer.sendControl(value)
  }
  const flush = () => {
    clearTimeout(moveTimer)
    moveTimer = undefined
    if (move) send(move)
    move = undefined
  }
  const release = () => {
    clearTimeout(moveTimer)
    moveTimer = undefined
    move = undefined
    keys.clear()
    send({...base(), type: "releaseAll"}, true)
  }
  const lifecycle = options.lifecycle ?? (typeof globalThis.window === "undefined" ? undefined : globalThis.window)
  const boundary = () => {release(); options.onBoundary?.()}
  const hidden = () => {if (lifecycle?.document.visibilityState !== "visible") boundary()}
  lifecycle?.addEventListener("blur", boundary)
  lifecycle?.addEventListener("pagehide", boundary)
  lifecycle?.document.addEventListener("visibilitychange", hidden)
  const viewerState = (snapshot: CapsuleRtcViewerSnapshot) => {
    if (snapshot.controlStatus !== "open" || snapshot.status === "failed" || snapshot.status === "disconnected") release()
    viewerError = snapshot.error ?? snapshot.controlError ?? ""
    emit({...state, status: snapshot.status, controlStatus: snapshot.controlStatus, error: mediaError || viewerError})
  }
  return {
    async start() {
      if (started || closed) return
      started = true
      emit({...state, status: "connecting", error: ""})
      try {
        const descriptor = await options.open(controller.signal)
        if (closed || controller.signal.aborted) return
        viewer = (options.viewerFactory ?? (options => new CapsuleRtcViewer(options)))({
          serverOrigin: options.origin, instanceId: descriptor.instanceId, controlEnabled: true,
          socketFactory: generated => {
            const peer = new URL(generated).searchParams.get("peer")
            const url = new URL(descriptor.socketPath, options.origin)
            if (url.origin !== new URL(options.origin).origin || url.pathname !== "/api/browser/capsule-viewer" || !peer) throw new Error("Некорректный адрес viewer")
            url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
            url.searchParams.set("peer", peer)
            return new WebSocket(url)
          },
          onState: viewerState,
          onStream: stream => {
            if (!closed && stream !== null && typeof stream === "object" && "getVideoTracks" in stream && typeof stream.getVideoTracks === "function") {
              void media.attach(stream as CapsuleRtcMediaStreamLike).catch(error => {if (!closed) emit({...state, error: error instanceof Error ? error.message : String(error)})})
            }
          },
          onControlMessage: message => {
            if (message !== null && typeof message === "object" && "type" in message && message.type === "inputState" && "status" in message && message.status === "ready" &&
              "width" in message && typeof message.width === "number" && "height" in message && typeof message.height === "number" &&
              Number.isInteger(message.width) && message.width > 0 && message.width <= 32768 && Number.isInteger(message.height) && message.height > 0 && message.height <= 32768) {
              screen = {width: message.width, height: message.height}
            }
          },
        })
        viewer.connect()
      } catch (error) {
        if (!closed) {viewer?.close(); media.clear(); emit({...state, status: "failed", error: error instanceof Error ? error.message : String(error)})}
      }
    },
    pointer(type: "pointerDown" | "pointerUp" | "pointerMove", event: Pick<PointerEvent, "clientX" | "clientY" | "button" | "buttons" | "detail">, captured = false): boolean {
      if (!control || state.controlStatus !== "open" || options.video.videoWidth < 1 || options.video.videoHeight < 1) return false
      const point = remotePoint(options.video, event.clientX, event.clientY, captured)
      if (!point) return false
      if (type === "pointerMove") {
        move = {...base(), type, ...point, buttons: event.buttons & 31}
        moveTimer ??= setTimeout(flush, 32)
        return true
      }
      flush()
      const buttons: readonly InputButton[] = ["left", "middle", "right", "back", "forward"]
      const button = buttons[event.button]
      if (!button) return false
      if (type === "pointerDown") send({...base(), type: "focus"})
      return send({...base(), type, ...point, button, buttons: event.buttons & 31, clickCount: Math.max(1, Math.min(4, event.detail || 1))})
    },
    wheel(event: Pick<WheelEvent, "clientX" | "clientY" | "deltaX" | "deltaY" | "deltaMode">): boolean {
      if (options.video.videoWidth < 1 || options.video.videoHeight < 1) return false
      const point = remotePoint(options.video, event.clientX, event.clientY)
      if (!point) return false
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? options.video.videoHeight : 1
      flush()
      return send({...base(), type: "wheel", ...point, deltaX: Math.max(-100000, Math.min(100000, event.deltaX * scale)), deltaY: Math.max(-100000, Math.min(100000, event.deltaY * scale))})
    },
    key(type: "keyDown" | "keyUp", event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "isComposing" | "repeat">): boolean {
      if (event.isComposing || !event.key || event.key.length > 64 || event.code.length > 64 || event.key === "Meta" || event.key === "Control") return false
      const identity = event.code || event.key
      if (type === "keyUp") {
        const command = keys.get(identity)
        keys.delete(identity)
        return command ? send({...command, ...base(), type}) : false
      }
      // Печатные символы и paste поступают через semantic textarea / IME.
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey || (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") return false
      if (keys.size >= 32 && !keys.has(identity)) return false
      const modifiers: InputModifier[] = []
      if (event.ctrlKey || event.metaKey) modifiers.push("control")
      if (event.altKey) modifiers.push("alt")
      if (event.shiftKey) modifiers.push("shift")
      const command = {...base(), type, key: event.key, ...(event.code ? {code: event.code} : {}), modifiers}
      const sent = send(command)
      if (sent) keys.set(identity, command)
      return sent
    },
    text(value: string): boolean {
      if (!value || value.includes("\0") || value.length > 32768) return false
      let sent = false
      for (let index = 0; index < value.length;) {
        let end = Math.min(value.length, index + 2048)
        const previous = value.charCodeAt(end - 1)
        if (end < value.length && previous >= 0xd800 && previous <= 0xdbff) end--
        sent = send({...base(), type: "text", text: value.slice(index, end)}) || sent
        index = end
      }
      return sent
    },
    paste(value: string): boolean {
      return value.length <= 32768 && !value.includes("\0") && send({...base(), type: "clipboardWrite", text: value, paste: true})
    },
    setControl(enabled: boolean) {if (!enabled) release(); control = enabled},
    mute(value: boolean) {media.setMuted(value)},
    release,
    close() {
      if (closed) return
      release()
      closed = true
      controller.abort()
      lifecycle?.removeEventListener("blur", boundary)
      lifecycle?.removeEventListener("pagehide", boundary)
      lifecycle?.document.removeEventListener("visibilitychange", hidden)
      viewer?.close()
      viewer = undefined
      media.clear()
    },
  }
}
