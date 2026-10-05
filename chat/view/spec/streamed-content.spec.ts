/** Границы транспортных кусочков не становятся абзацами или разрывами Markdown. */
import {expect, test} from "bun:test"
import {createRoot} from "@zavx0z/immersive-component"
import {createDocument} from "@zavx0z/immersive-dom"
import {ChatTimeline} from "../src/timeline"
import type {StorybookChatView as Contract} from "../contract"

test("потоковый и повторно открытый ответ показывают целые слова и Markdown", async () => {
  const document = createDocument()
  const element = document.createElement("section")
  document.append(element)
  const component = createRoot(element)
  const chunks = ["В", "иж", "у", " два", " наб", "ора", ".\n\n", "**", "В", " перед", "ан", "ном контексте", "**", " доступны инструменты."]
  type Timeline = NonNullable<Contract.Input["timeline"]>
  const reply = {id: "reply", kind: "message", origin: "live", sequence: 1, role: "assistant",
    content: chunks.slice(0, 7).map(text => ({type: "text" as const, text})),
  } satisfies Timeline[number]
  let timeline: Timeline = [reply]
  const render = async () => {
    // Штатный owner preload компилирует авторскую TSX-функцию в template ABI.
    component.render(ChatTimeline as unknown as Parameters<typeof component.render>[0], {timeline, messages: []})
    await Bun.sleep(0)
    component.flush()
  }
  try {
    await render()
    const message = element.querySelector('[data-chat-message="reply"]')!
    expect(Array.from(message.querySelectorAll("p"), node => node.textContent),
      "Кусочки слова образуют один абзац, а не вертикальную колонку").toEqual(["Вижу два набора."])
    timeline = [{...reply, content: chunks.map(text => ({type: "text" as const, text}))}]
    const saved = structuredClone(timeline)
    await render()
    expect(element.querySelector('[data-chat-message="reply"]'), "Дополнение сохраняет запись сообщения").toBe(message)
    expect(Array.from(message.querySelectorAll("p"), node => node.textContent)).toEqual([
      "Вижу два набора.", "В переданном контексте доступны инструменты.",
    ])
    expect(message.querySelector("strong")?.textContent, "Маркеры из разных дельт образуют единое выделение").toBe("В переданном контексте")
    expect(timeline, "Представление не переписывает транспортные свидетельства").toEqual(saved)
    timeline = structuredClone(saved)
    await render()
    expect(message.querySelectorAll("p")).toHaveLength(2)
    expect(message.querySelector("strong")?.textContent).toBe("В переданном контексте")
  } finally { component.unmount() }
})
