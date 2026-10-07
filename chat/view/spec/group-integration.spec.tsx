import {expect, test} from "bun:test"
import {Event, createDocument} from "@zavx0z/immersive-dom"
import {createRoot} from "@zavx0z/immersive-component"
import {createDocumentRenderer} from "@zavx0z/immersive-renderer-html"
import {flushDocumentLayoutObservers} from "@zavx0z/immersive-dom/geometry"
import type {CompiledTemplate} from "@zavx0z/immersive-template/compiled"
import type {StorybookChatView} from "../contract"
import {createChatHistoryWindow} from "../../../app/web/page/shell/workbench/src/inspector/chat-history"
import GroupIntegration, {type GroupIntegrationProps} from "./fixture/group-integration"

test("external-store раскрытие группы стабилизируется без render-phase notify и утечки контроллеров", async () => {
  const document = createDocument()
  const element = document.createElement("div")
  document.append(element)
  const root = createRoot(element)
  const theme = await Bun.file(new URL(import.meta.resolve("@zavx0z/immersive-ui-component/theme/theme.css"))).text()
  const renderer = createDocumentRenderer({document, root: element, viewport: {width: 480, height: 700}, styleSheets: [theme]})
  const group = {id: "service:user:u", kind: "group" as const, origin: "local" as const, ordinal: 2, sequence: 2,
    revision: 1, bodyBytes: 0 as const, evidenceCount: 1000, memberCount: 1000, userId: "u", lastSequence: 1001, title: "Действия агента"}
  let revision = 1
  let notifications = 0
  let renders = 0
  let creations = 0
  let disposals = 0
  let factoryActive = false
  let factoryNotifications = 0
  const calls: {operation: string; signal: AbortSignal}[] = []
  const listeners = new Set<() => void>()
  let view: StorybookChatView.Input
  const history = createChatHistoryWindow({
    changed() {
      notifications++
      if (factoryActive) factoryNotifications++
      if (notifications > 200) throw new Error("История не стабилизировалась: больше 200 notifications")
      view = {...view, history: history.getSnapshot()}
      for (const listener of listeners) listener()
    },
    async read(operation, body, signal) {
      calls.push({operation, signal})
      if (operation === "history-display") return {chatId: "chat", revision, total: 1, rawTotal: 1000, projectionRevision: 1, start: 2, items: [{...group}], before: null, after: null}
      if (operation === "history-group") {
        expect(body.query).toMatchObject({limit: 16, before: Number.MAX_SAFE_INTEGER})
        return {chatId: "chat", groupId: group.id, revision, total: 1000, start: 986, before: 986, after: null,
          items: Array.from({length: 16}, (_, i) => ({id: `event:${i}`, entryId: `event:${i}`, groupId: group.id,
            kind: "event", origin: "live", eventType: "usage_update", ordinal: i + 986, sequence: i + 986, revision: 1, bodyBytes: 100, evidenceCount: 0}))}
      }
      if (operation === "history-group-item") return new Promise<never>((_resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"))
        if (signal.aborted) abort()
        else signal.addEventListener("abort", abort, {once: true})
      })
      throw new Error(`Неожиданная операция ${operation}`)
    },
  })
  let nested: ReturnType<typeof history.createGroupHistory> | undefined
  view = {address: "/", label: "Chat", status: "idle", draft: "", history: history.getSnapshot(),
    createGroupHistory(value) {
      factoryActive = true
      try {
        creations++
        const created = history.createGroupHistory(value)
        nested = {...created, dispose() {disposals++; created.dispose()}}
        return nested
      } finally {factoryActive = false}
    },
    onDraftChange() {}, onSend() {}, onCancel() {},
    onHistoryViewport: history.viewport, onHistoryVisible: history.setActive, onHistoryExpand: history.expand,
    onHistoryRetry: history.retry, onHistoryEvidence: history.evidence, onHistoryTail: history.tail,
  }
  const store = {
    getSnapshot: () => view,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener)}},
    rendered() {renders++; if (renders > 200) throw new Error("Больше 200 render")},
  }
  const settle = async () => {
    for (let turn = 0; turn < 8; turn++) {
      root.flush()
      renderer.flush()
      flushDocumentLayoutObservers(document)
      await Bun.sleep(0)
    }
  }
  try {
    history.accept({id: "chat", executorId: "agent", history: {revision: 1, total: 1000, lastSequence: 1001}, displayHistory: {revision: 1, total: 1, lastSequence: 1001}} as Parameters<typeof history.accept>[0])
    await Bun.sleep(0)
    root.render(GroupIntegration as unknown as CompiledTemplate<GroupIntegrationProps>, {store})
    await settle()
    Bun.gc(true)
    const heapBefore = process.memoryUsage().heapUsed
    let peakRows = 0
    for (let cycle = 0; cycle < 3; cycle++) {
      const button = element.querySelector('[data-chat-kind="group"] [aria-expanded="false"]')!
      expect(button).not.toBeNull()
      button.dispatchEvent(new Event("pointerdown", {bubbles: true}))
      button.dispatchEvent(new Event("click", {bubbles: true}))
      await settle()
      expect(factoryNotifications).toBe(0)
      expect(element.querySelectorAll("[data-chat-service-group]")).toHaveLength(1)
      expect(nested!.getSnapshot().rows).toHaveLength(16)
      peakRows = Math.max(peakRows, element.querySelectorAll("[data-chat-history-id]").length)
      const stable = notifications
      await settle()
      expect(notifications).toBe(stable)
      if (cycle === 0) {
        const currentController = nested
        revision++
        group.revision = revision
        history.accept({id: "chat", executorId: "agent", history: {revision, total: 1000, lastSequence: 1002}, displayHistory: {revision, total: 1, lastSequence: 1002}} as Parameters<typeof history.accept>[0])
        await settle()
        expect(nested).toBe(currentController)
        expect(creations).toBe(1)
        expect(disposals).toBe(0)
      }
      nested!.viewport({ids: ["event:15"], nearStart: false, nearEnd: false, following: true})
      nested!.expand("event:15", true)
      await Bun.sleep(0)
      const request = calls.filter(call => call.operation === "history-group-item").at(-1)!
      const collapse = element.querySelector('[data-chat-kind="group"] [aria-expanded="true"]')!
      collapse.dispatchEvent(new Event("pointerdown", {bubbles: true}))
      collapse.dispatchEvent(new Event("click", {bubbles: true}))
      await settle()
      expect(request.signal.aborted).toBeTrue()
      expect(nested!.getSnapshot().rows).toHaveLength(0)
      expect(element.querySelectorAll("[data-chat-service-group]")).toHaveLength(0)
    }
    expect(creations).toBe(3)
    expect(disposals).toBe(3)
    expect(calls.filter(call => call.operation === "history-group")).toHaveLength(4)
    expect(calls.filter(call => call.operation === "history-item")).toHaveLength(0)
    expect(renders).toBeLessThan(80)
    Bun.gc(true)
    const heapAfter = process.memoryUsage().heapUsed
    expect(peakRows).toBeLessThanOrEqual(17)
    expect(listeners.size).toBe(1)
    console.log(JSON.stringify({groupCycles: 3, renders, notifications, creations, disposals, reads: calls.length, factoryNotifications, peakRows, heapBefore, heapAfter, heapDelta: heapAfter - heapBefore}))
  } finally {history.dispose(); root.unmount(); renderer.dispose()}
}, 20_000)

test("33 KiB Markdown и два одинаковых вопроса стабилизируются без повторных notify, render и измерений", async () => {
  const document = createDocument()
  const element = document.createElement("div")
  document.append(element)
  const root = createRoot(element)
  const theme = await Bun.file(new URL(import.meta.resolve("@zavx0z/immersive-ui-component/theme/theme.css"))).text()
  const renderer = createDocumentRenderer({document, root: element, viewport: {width: 480, height: 700}, styleSheets: [theme]})
  // Искусственный текст воспроизводит объём и Markdown, не сохраняет реальный bootstrap.
  const paragraph = "## Synthetic section\n\nA bounded offline paragraph with **formatted text** and a list.\n\n- One fixture item\n- Another fixture item\n\n"
  const bootstrap = paragraph.repeat(Math.ceil(33 * 1024 / paragraph.length)).slice(0, 33 * 1024)
  const question = "Ответь только словом подключено"
  const messages = [
    {id: "synthetic-bootstrap", sequence: 1, kind: "message" as const, origin: "replay" as const, role: "user" as const,
      providerMessageId: "synthetic-bootstrap", content: [{type: "text" as const, text: bootstrap}]},
    ...[2, 3].map(sequence => ({id: `question-${sequence}`, sequence, kind: "message" as const, origin: "local" as const, role: "user" as const,
      content: [{type: "text" as const, text: question}]})),
  ]
  const calls: {operation: string, id: unknown}[] = []
  const listeners = new Set<() => void>()
  let notifications = 0
  let renders = 0
  let measurements = 0
  let view: StorybookChatView.Input
  const history = createChatHistoryWindow({
    changed() {
      if (++notifications > 200) throw new Error("История не стабилизировалась: больше 200 notifications")
      view = {...view, history: history.getSnapshot()}
      for (const listener of listeners) listener()
    },
    async read(operation, body) {
      calls.push({operation, id: body.id})
      if (operation === "history-display") return {chatId: "chat", revision: 1, total: messages.length, rawTotal: messages.length,
        projectionRevision: 1, start: 0, before: null, after: null,
        items: messages.map((entry, ordinal) => ({id: entry.id, kind: entry.kind, origin: entry.origin, role: entry.role,
          ordinal, sequence: entry.sequence, revision: 1, bodyBytes: new TextEncoder().encode(JSON.stringify(entry)).byteLength, evidenceCount: 0}))}
      if (operation === "history-item") {
        const entry = messages.find(message => message.id === body.id)
        if (!entry) throw new Error("Неизвестная запись fixture")
        return {chatId: "chat", id: entry.id, revision: 1, bytes: new TextEncoder().encode(JSON.stringify(entry)).byteLength,
          entry, evidenceCount: 0}
      }
      throw new Error(`Неожиданная операция ${operation}`)
    },
  })
  view = {address: "/synthetic-convergence", label: "Offline fixture", status: "idle", draft: "", history: history.getSnapshot(),
    onDraftChange() {}, onSend() {}, onCancel() {},
    onHistoryViewport(value) {measurements++; history.viewport(value)},
    onHistoryVisible: history.setActive, onHistoryExpand: history.expand, onHistoryRetry: history.retry,
    onHistoryEvidence: history.evidence, onHistoryTail: history.tail,
  }
  const store = {
    getSnapshot: () => view,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener)}},
    rendered() {if (++renders > 200) throw new Error("Больше 200 render")},
  }
  const settle = async () => {
    for (let turn = 0; turn < 8; turn++) {
      root.flush()
      renderer.flush()
      flushDocumentLayoutObservers(document)
      await Bun.sleep(0)
    }
  }
  const counters = () => ({notifications, renders, measurements, requests: calls.length})
  try {
    expect(new TextEncoder().encode(bootstrap).byteLength).toBe(33 * 1024)
    history.accept({id: "chat", executorId: "agent", history: {revision: 1, total: messages.length, lastSequence: 3},
      displayHistory: {revision: 1, total: messages.length, lastSequence: 3}} as Parameters<typeof history.accept>[0])
    await Bun.sleep(0)
    root.render(GroupIntegration as unknown as CompiledTemplate<GroupIntegrationProps>, {store})
    await settle()
    expect(calls.filter(call => call.operation === "history-item" && call.id === "synthetic-bootstrap")).toHaveLength(1)
    expect(element.querySelectorAll('[data-chat-history-id="question-2"]')).toHaveLength(1)
    expect(element.querySelectorAll('[data-chat-history-id="question-3"]')).toHaveLength(1)
    const stable = counters()
    await settle()
    expect(counters(), "Новая геометрия и входные события отсутствуют: история не запускает повторную работу").toEqual(stable)
    expect(listeners.size).toBe(1)
  } finally {history.dispose(); root.unmount(); renderer.dispose()}
}, 20_000)
