/** Обновление props сохраняет keyed запись и её раскрытие, включая повторную проекцию снимка. */
import {expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive/headless"
import type {HTMLButtonElement} from "@zavx0z/immersive"
import StorybookChatView, {type FixtureContract as Contract} from "./fixture/history"

test("дополнение вызова сохраняет раскрытие по id и не создаёт детали закрытого контекста", async () => {
  const headless = createHeadless({width: 400, height: 600})
  let timeline: NonNullable<Contract.Input["timeline"]> = [
    {id: "context", kind: "context", origin: "local", sequence: 1, content: [{type: "text", text: "Скрытый контекст"}]},
    {id: "tool", kind: "tool", origin: "live", sequence: 2, toolCallId: "call", call: {
      sessionUpdate: "tool_call", toolCallId: "call", title: "Проверка", status: "in_progress",
    }, updates: []},
  ]
  const render = () => headless.render(
    <StorybookChatView
      address="/stream"
      label="Поток"
      timeline={timeline}
      messages={[]}
      draft=""
      status="running"
      onDraftChange={() => {}}
      onSend={() => {}}
      onCancel={() => {}}
    />,
  )
  try {
    const element = await render()
    const tool = element.querySelector('[data-chat-entry="tool"]')!
    expect(tool.querySelector("[data-chat-details]"), "Детали не монтируются заранее").toBeNull()
    const button = tool.querySelector("button") as HTMLButtonElement
    button.click()
    await headless.capture(element)
    expect(tool.querySelector("[data-chat-details]"), "Открытие монтирует детали выбранной записи").not.toBeNull()
    timeline = [timeline[0]!, {
      id: "tool", kind: "tool", origin: "live", sequence: 2, toolCallId: "call", call: {
        sessionUpdate: "tool_call", toolCallId: "call", title: "Проверка", status: "completed",
        content: [{type: "content", content: {type: "text", text: "Полученный результат"}}],
      }, updates: [],
    }]
    await render()
    expect(element.querySelector('[data-chat-entry="tool"]'), "Новый снимок использует ту же запись").toBe(tool)
    expect(tool.querySelector("[data-chat-details]")?.textContent,
      "Открытая запись остаётся открытой и показывает дополненный результат").toContain("Полученный результат")
    expect(element.querySelector('[data-chat-entry="context"] [data-chat-details]'),
      "Обновление соседнего инструмента не раскрывает контекст").toBeNull()
    timeline = structuredClone(timeline)
    await render()
    expect(tool.querySelector("[data-chat-details]"),
      "Повторная проекция снимка сохраняет раскрытие без зависимости от identity JSON-объекта").not.toBeNull()
    button.click()
    await headless.capture(element)
    expect(tool.querySelector("[data-chat-details]"), "Закрытие освобождает подробное содержимое").toBeNull()
  } finally {
    await headless.dispose()
  }
})
