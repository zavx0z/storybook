/** Resident headers и видимые тела составляют один bounded DOM без полной timeline. */
import {expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import ChatView, {type StorybookChatView} from "../index"
import {ChatData} from "../src/content"

test("смена окна удаляет старые строки и тела; viewport сообщает только измеренные видимые ids", async () => {
  const headless = createHeadless({width: 400, height: 600})
  const visible: string[][] = []
  const rows = (start: number): StorybookChatView.Input["history"]["rows"] => Array.from({length: 96}, (_, offset) => {
    const id = `m${start + offset}`
    return {header: {id, kind: "message", role: "assistant", origin: "live", ordinal: start + offset, sequence: start + offset + 1, revision: 1, bodyBytes: 50, evidenceCount: 0}, expanded: false, loading: false,
      body: offset < 2 ? {id, kind: "message", role: "assistant", origin: "live", sequence: start + offset + 1, content: [{type: "text", text: `Тело ${id}`}]} : undefined}
  })
  let history: StorybookChatView.Input["history"] = {chatId: "chat", revision: 1, total: 10000, rows: rows(0), before: null, after: 95, unread: 0, following: false, loading: false}
  const render = () => headless.render(<ChatView
    address="/"
    label="Project"
    history={history}
    draft=""
    status="idle"
    onDraftChange={() => {}}
    onSend={() => {}}
    onCancel={() => {}}
    onHistoryViewport={value => visible.push([...value.ids])}
    onHistoryVisible={() => {}}
    onHistoryExpand={() => {}}
    onHistoryRetry={() => {}}
    onHistoryEvidence={() => {}}
    onHistoryTail={() => {}}
  />)
  try {
    const element = await render()
    await headless.capture(element)
    expect(element.querySelectorAll("[data-chat-history-id]")).toHaveLength(96)
    expect(element.querySelectorAll("[data-chat-message]")).toHaveLength(2)
    const old = element.querySelector('[data-chat-history-id="m0"]')!
    expect(visible.at(-1)!.length).toBeGreaterThan(0)
    expect(visible.at(-1)!.length).toBeLessThan(96)
    history = {...history, rows: rows(96), before: 96, after: 191}
    await render()
    expect(old.isConnected).toBe(false)
    expect(element.textContent).not.toContain("Тело m0")
    expect(element.querySelectorAll("[data-chat-history-id]")).toHaveLength(96)
    history = {...history, rows: []}
    await render()
    expect(element.querySelectorAll("[data-chat-history-id]")).toHaveLength(0)
  } finally {await headless.dispose()}
})

test("readonly short content имеет intrinsic height, long content ограничен240px и штатным DOM window", async () => {
  const headless = createHeadless({width: 400, height: 600})
  try {
    const element = await headless.render(<ChatData label="JSON" value={{ok: true}} />)
    await headless.capture(element)
    const short = element.querySelector('[aria-readonly="true"]')!
    expect(short.getLayoutRect()!.height).toBeLessThan(240)
    const long = "Строка исходника\n".repeat(1000)
    await headless.render(<ChatData label="JSON" value={long} />)
    await headless.capture(element)
    const editor = element.querySelector('[aria-readonly="true"]')!
    expect(editor.getLayoutRect()!.height).toBeLessThanOrEqual(240)
    expect(editor.querySelectorAll("[data-code-row-index]").length).toBeLessThan(1000)
  } finally {await headless.dispose()}
})
