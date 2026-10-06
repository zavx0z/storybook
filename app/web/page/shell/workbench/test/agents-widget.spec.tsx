import {expect, test} from "bun:test"
import {createRoot} from "@zavx0z/immersive-component"
import {createDocument, registerDocumentGeometryReader, InputEvent, type HTMLButtonElement, type HTMLInputElement} from "@zavx0z/immersive-dom"
import {flushDocumentLayoutObservers} from "@zavx0z/immersive-dom/geometry"
import type {CompiledTemplate} from "@zavx0z/immersive-template/compiled"
import {AgentsWidget} from "../src/inspector/agents-widget"
import type {WorkbenchInspectorCustomWidgetProps} from "../contract/workbench"
import {readChatSelection} from "../src/inspector/chat-selection"

function fixture() {
  const document = createDocument()
  const host = document.createElement("div")
  document.append(host)
  const component = createRoot(host)
  let visible = true
  const release = registerDocumentGeometryReader(document, host, () => [], () => visible ? {x: 0, y: 0, width: 400, height: 600} : null)
  const snapshot = {id: "one", sessionId: "one", sessionLabel: "Первая", address: "/agents-test", executorId: "agent", executorLabel: "Главный", pending: [], label: "Project", history: {revision: 0, total: 0, lastSequence: 0}, status: "idle", error: null, permissions: [], version: 0}
  let sessions = [snapshot]
  let deleted = [{...snapshot, id: "removed", sessionId: "removed", sessionLabel: "Удалённая беседа", recoverable: true}]
  const calls: {operation: string, body: Record<string, unknown>, signal: AbortSignal | null | undefined}[] = []
  let hold = false
  let late: ((response: Response) => void) | null = null
  const fetcher = (async (url, init) => {
    const operation = String(url).split("/").at(-1)!
    if (operation === "registry-session") return Response.json({readerToken: "grant"})
    const body = JSON.parse(String(init?.body))
    calls.push({operation, body, signal: init?.signal})
    if (operation === "list") return Response.json([snapshot])
    if (operation === "sessions") {
      if (hold) return new Promise<Response>(resolve => {late = resolve})
      return Response.json(sessions)
    }
    if (operation === "sessions-deleted") return Response.json(deleted)
    if (operation === "session-restore") {
      const item = deleted.find(item => item.id === body.sessionId)!
      deleted = deleted.filter(item => item.id !== body.sessionId)
      sessions = [...sessions, item]
      return Response.json(item)
    }
    if (operation === "session-purge") {deleted = deleted.filter(item => item.id !== body.sessionId); return Response.json({deleted: true})}
    if (operation === "create") return Response.json({error: "Не удалось создать"}, {status: 503})
    return Response.json(snapshot)
  }) as typeof fetch
  component.render(AgentsWidget as unknown as CompiledTemplate<WorkbenchInspectorCustomWidgetProps>, {value: {address: snapshot.address, label: "Project", fetcher}, expandedKeys: [], onExpandedChange() {}})
  const settle = async () => {for (let round = 0; round < 8; round++) {component.flush(); flushDocumentLayoutObservers(document); await Bun.sleep(0)}}
  return {host, calls, document, settle, hold() {hold = true}, late() {late?.(Response.json([snapshot]))}, hide() {visible = false}, dispose() {component.unmount(); release()}}
}

test("Agents раскрывает только запрошенные имена; collapse abort/eviction, повторное открытие re-fetch и точная selection", async () => {
  const f = fixture()
  try {
    await f.settle()
    expect(f.calls.filter(call => call.operation === "sessions")).toHaveLength(0)
    const toggle = f.host.querySelector('button[aria-expanded="false"]') as HTMLButtonElement
    toggle.click()
    await f.settle()
    expect(f.host.querySelector('[data-conversation-id="one"]')?.textContent).toContain("Первая")
    const select = f.host.querySelector('[data-conversation-id="one"] button') as HTMLButtonElement
    select.click()
    await f.settle()
    expect(readChatSelection("/agents-test")).toEqual({executorId: "agent", sessionId: "one", title: "Первая"})
    toggle.click()
    await f.settle()
    expect(f.host.querySelector("[data-conversation-list]")).toBeNull()
    f.hold()
    toggle.click()
    await f.settle()
    const request = f.calls.filter(call => call.operation === "sessions").at(-1)!
    expect(request.body).toEqual({address: "/agents-test", executorId: "agent"})
    toggle.click()
    await f.settle()
    expect(request.signal?.aborted).toBe(true)
    f.late()
    await f.settle()
    expect(f.host.querySelector("[data-conversation-list]")).toBeNull()
    expect(f.calls.filter(call => call.operation === "sessions")).toHaveLength(2)
    expect(f.calls.some(call => call.operation === "prompt" || call.operation === "cancel")).toBe(false)
  } finally {f.dispose()}
})

test("создание агента блокирует double click; backend refusal сохраняет введённое имя без отправки задачи", async () => {
  const f = fixture()
  try {
    await f.settle()
    const input = f.host.querySelector("input") as HTMLInputElement
    input.value = "Исследователь"
    input.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: "Исследователь"}))
    await f.settle()
    const button = [...f.host.querySelectorAll("button")].find(button => button.textContent === "Добавить специалиста") as HTMLButtonElement
    button.click()
    button.click()
    await f.settle()
    expect(f.calls.filter(call => call.operation === "create")).toHaveLength(1)
    expect(input.value).toBe("Исследователь")
    expect(f.host.querySelector('[role="alert"]')?.textContent).toContain("Не удалось создать")
    expect(f.calls.some(call => call.operation === "prompt")).toBe(false)
  } finally {f.dispose()}
})

test("корзина агента читается по запросу, восстановление сохраняет точную selection без prompt", async () => {
  const f = fixture()
  const button = (label: string) => [...f.host.querySelectorAll("button")].find(button => button.textContent === label) as HTMLButtonElement
  try {
    await f.settle()
    const toggle = f.host.querySelector('button[aria-expanded="false"]') as HTMLButtonElement
    toggle.click()
    await f.settle()
    expect(f.calls.some(call => call.operation === "sessions-deleted")).toBe(false)
    button("Корзина").click()
    await f.settle()
    expect(f.host.querySelector('[data-deleted-conversation="removed"]')?.textContent).toContain("Удалённая беседа")
    button("Восстановить").click()
    await f.settle()
    expect(f.calls.filter(call => call.operation === "session-restore")).toHaveLength(1)
    expect(readChatSelection("/agents-test")).toEqual({executorId: "agent", sessionId: "removed", title: "Удалённая беседа"})
    expect(f.host.querySelector('[data-conversation-id="removed"]')).not.toBeNull()
    expect(f.calls.some(call => call.operation === "prompt")).toBe(false)
  } finally {f.dispose()}
})

test("окончательное удаление из корзины требует отдельной кнопки подтверждения", async () => {
  const f = fixture()
  const button = (label: string) => [...f.host.querySelectorAll("button")].find(button => button.textContent === label) as HTMLButtonElement
  try {
    await f.settle()
    const toggle = f.host.querySelector('button[aria-expanded="false"]') as HTMLButtonElement
    toggle.click()
    await f.settle()
    button("Корзина").click()
    await f.settle()
    button("Удалить навсегда…").click()
    await f.settle()
    expect(f.calls.some(call => call.operation === "session-purge")).toBe(false)
    button("Да, удалить навсегда").click()
    await f.settle()
    expect(f.calls.filter(call => call.operation === "session-purge")).toHaveLength(1)
    expect(f.host.textContent).toContain("Корзина пуста")
  } finally {f.dispose()}
})
