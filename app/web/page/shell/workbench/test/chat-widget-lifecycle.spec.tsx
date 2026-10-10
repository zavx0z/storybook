import {expect, test} from "bun:test"
import {createRoot} from "@zavx0z/immersive/XReact"
import {createDocument, Event, InputEvent, type HTMLTextAreaElement} from "@zavx0z/immersive"
import {createSpaceElementFactories} from "@zavx0z/immersive/space"
import {createDocumentRenderer} from "@zavx0z/immersive/renderer/html"
import {flushDocumentLayoutObservers} from "@zavx0z/immersive"
import type {CompiledTemplate} from "@zavx0z/immersive/XReact/compiled"
import createViewPointControls from "@zavx0z/storybook-app-web-page-shell-viewpoint-controls"
import type {ChatBrowserSnapshot} from "../src/inspector/chat-client"
import {readChatSelection, selectChatSession} from "../src/inspector/chat-selection"
import ChatWidgetLifecycle, {type ChatWidgetLifecycleProps} from "./fixture/chat-widget-lifecycle"

class Socket extends EventTarget {
  closed = false
  readonly sent: unknown[] = []
  constructor(_url: string | URL) {
    super()
    queueMicrotask(() => {if (!this.closed) this.dispatchEvent(new globalThis.Event("open"))})
  }
  send(value: string) {this.sent.push(JSON.parse(value))}
  close() {if (!this.closed) {this.closed = true; this.dispatchEvent(new globalThis.Event("close"))}}
  snapshot(value: ChatBrowserSnapshot) {this.dispatchEvent(new MessageEvent("message", {data: JSON.stringify({type: "chat.snapshot", address: value.address, snapshot: value})}))}
}

test.each([{settingsReady: true, small: false}, {settingsReady: false, small: false}, {settingsReady: true, small: true}])("actual ChatWidget settingsReady=$settingsReady small=$small: стабильный lifecycle", async ({settingsReady, small}) => {
  const previousSocket = Object.getOwnPropertyDescriptor(globalThis, "WebSocket")
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location")
  const sockets: Socket[] = []
  class ObservedSocket extends Socket {constructor(url: string | URL) {super(url); sockets.push(this)}}
  Object.defineProperty(globalThis, "WebSocket", {configurable: true, value: ObservedSocket})
  Object.defineProperty(globalThis, "location", {configurable: true, value: {href: "http://storybook.test/"}})
  const document = createDocument({elementFactories: createSpaceElementFactories()})
  const element = document.createElement("div")
  document.append(element)
  const root = createRoot(element)
  const theme = await Bun.file(new URL(import.meta.resolve("@zavx0z/immersive/ui/theme.css"))).text()
  const renderer = createDocumentRenderer({document, root: element, viewport: {width: 354, height: 700}, styleSheets: [theme]})
  const camera = document.createElement("viewpoint")
  const controls = createViewPointControls()
  controls.bind(camera, () => {})
  const address = `/actual-widget-${crypto.randomUUID()}`
  const modelSettings: NonNullable<ChatBrowserSnapshot["settings"]> = [{id: "model", category: "model", name: "Model", value: "a", options: [{value: "a", name: "A"}]}]
  let snapshot: ChatBrowserSnapshot = {id: "actual-widget-session", sessionId: "actual-widget-session", sessionLabel: "Беседа", executorId: "actual-widget-agent", executorLabel: "Агент",
    address, label: "Project", pending: [], status: small ? "running" : "idle", error: null,
    permissions: small ? [{id: "pending-permission", title: "Подтвердите действие", options: [{id: "once", name: "Разрешить один раз", kind: "allow_once"}]}] : [], version: 1,
    history: {revision: 1, total: 109, lastSequence: 109}, displayHistory: {revision: 1, total: 1, lastSequence: 109},
    settings: settingsReady ? modelSettings : []}
  const group = {id: "service:user:u", kind: "group", origin: "local", ordinal: 1, sequence: 2, revision: 1, bodyBytes: 0,
    evidenceCount: 108, memberCount: 108, userId: "u", lastSequence: 109, title: "Действия агента"}
  const calls: {operation: string, signal: AbortSignal | undefined | null}[] = []
  let renders = 0
  const fetcher = (async (url, init) => {
    const operation = String(url).split("/").at(-1)!
    calls.push({operation, signal: init?.signal})
    if (operation === "registry-session") return Response.json({readerToken: "fixture-grant"})
    if (operation === "session") return Response.json(snapshot)
    if (operation === "prepare") {
      snapshot = {...snapshot, version: snapshot.version + 1, settings: modelSettings}
      return Response.json(snapshot)
    }
    if (operation === "history-display") return Response.json({chatId: snapshot.id, revision: 1, total: 1, rawTotal: 109, start: 1, items: [group], before: null, after: null})
    if (operation === "history-group") return Response.json({chatId: snapshot.id, groupId: group.id, revision: 1, total: 108, start: 93, before: 93, after: null,
      items: Array.from({length: 16}, (_, index) => ({id: `event:${index}`, entryId: `event:${index}`, groupId: group.id,
        kind: "event", origin: "live", eventType: "usage_update", ordinal: index + 93, sequence: index + 94, revision: 1, bodyBytes: 100, evidenceCount: 0}))})
    if (operation === "history-group-item") return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException("Отменено", "AbortError"))
      if (init?.signal?.aborted) abort()
      else init?.signal?.addEventListener("abort", abort, {once: true})
    })
    throw new Error(`Неожиданная операция actual Widget: ${operation}`)
  }) as typeof fetch
  const props: ChatWidgetLifecycleProps = {context: {address, label: "Project", fetcher}, controls, height: small ? 120 : 700, rendered() {if (++renders > 100) throw new Error("Widget не стабилизировался")}}
  const settle = async () => {
    for (let turn = 0; turn < 8; turn++) {root.flush(); renderer.flush(); flushDocumentLayoutObservers(document); await Bun.sleep(0)}
  }
  const click = (selector: string) => {
    const button = element.querySelector(selector)
    expect(button).not.toBeNull()
    button!.dispatchEvent(new Event("pointerdown", {bubbles: true}))
    button!.dispatchEvent(new Event("click", {bubbles: true}))
  }
  try {
    selectChatSession(address, {})
    root.render(ChatWidgetLifecycle as unknown as CompiledTemplate<ChatWidgetLifecycleProps>, props)
    await settle()
    expect(readChatSelection(address)).toEqual({executorId: snapshot.executorId, sessionId: snapshot.id, title: "Беседа"})
    expect(calls.filter(call => call.operation === "prepare")).toHaveLength(settingsReady ? 0 : 1)
    expect(calls.some(call => call.operation === "prompt")).toBe(false)
    expect(sockets).toHaveLength(1)
    expect(sockets[0]!.closed).toBe(false)
    if (small) {
      // Padding обычной истории сохраняет 24 px даже в тесном родителе.
      // Проверяем именно нулевой viewport реальной раскладкой, без подмены geometry reader.
      const collapsed = {...props, collapseHistory: true}
      root.render(ChatWidgetLifecycle as unknown as CompiledTemplate<ChatWidgetLifecycleProps>, collapsed)
      await settle()
      expect(element.querySelector("[data-chat-messages]")!.getBoundingClientRect().height).toBe(0)
      expect(element.querySelectorAll("[data-chat-permission]")).toHaveLength(1)
      const reads = calls.length
      sockets[0]!.snapshot({...snapshot, version: 2})
      await settle()
      expect(sockets).toHaveLength(1)
      expect(sockets[0]!.closed).toBe(false)
      expect(element.querySelectorAll("[data-chat-permission]")).toHaveLength(1)
      expect(calls).toHaveLength(reads)
      root.render(ChatWidgetLifecycle as unknown as CompiledTemplate<ChatWidgetLifecycleProps>, {...collapsed, hidden: true})
      await settle()
      expect(sockets[0]!.closed).toBe(true)
      expect(calls.some(call => call.operation === "prepare")).toBe(false)
      root.render(ChatWidgetLifecycle as unknown as CompiledTemplate<ChatWidgetLifecycleProps>, collapsed)
      await settle()
      expect(sockets).toHaveLength(2)
      expect(element.querySelectorAll("[data-chat-permission]")).toHaveLength(1)
      expect(() => controls.dispose()).not.toThrow()
      root.unmount()
      expect(sockets.every(socket => socket.closed)).toBe(true)
      return
    }
    const textarea = element.querySelector("textarea") as HTMLTextAreaElement
    textarea.value = "Черновик перед применением"
    textarea.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: textarea.value}))
    await settle()
    for (let cycle = 0; cycle < 3; cycle++) {
      click('[data-chat-kind="group"] [aria-expanded="false"]')
      await settle()
      expect(element.querySelectorAll("[data-chat-service-group]")).toHaveLength(1)
      expect(element.querySelectorAll("[data-chat-service-group] [data-chat-history-id]")).toHaveLength(16)
      if (cycle < 2) {click('[data-chat-kind="group"] [aria-expanded="true"]'); await settle()}
    }
    click('[data-chat-service-group] [data-chat-history-id="event:15"] [aria-expanded="false"]')
    await settle()
    const pending = calls.filter(call => call.operation === "history-group-item")
    expect(pending.length).toBeGreaterThan(0)
    const before = calls.length
    controls.toggleFrozen()
    root.flush()
    renderer.flush()
    await settle()
    expect((element.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Черновик перед применением")
    // Это именно проблемный порядок release shell: publish controls при ещё смонтированном ChatWidget.
    expect(() => controls.dispose()).not.toThrow()
    root.flush()
    renderer.flush()
    root.unmount()
    await Bun.sleep(0)
    expect(pending.every(call => call.signal?.aborted)).toBe(true)
    expect(sockets.every(socket => socket.closed)).toBe(true)
    expect(calls.filter(call => call.operation === "history-group")).toHaveLength(3)
    expect(calls.slice(before).some(call => call.operation === "prompt" || call.operation === "cancel")).toBe(false)
    expect(renders).toBeLessThan(100)
    console.log(JSON.stringify({actualWidget: true, groupCycles: 3, renders, sockets: sockets.length, requests: calls.length, pendingAborted: pending.length}))
  } finally {
    controls.dispose()
    root.unmount()
    renderer.dispose()
    if (previousSocket) Object.defineProperty(globalThis, "WebSocket", previousSocket); else Reflect.deleteProperty(globalThis, "WebSocket")
    if (previousLocation) Object.defineProperty(globalThis, "location", previousLocation); else Reflect.deleteProperty(globalThis, "location")
  }
}, 20_000)
