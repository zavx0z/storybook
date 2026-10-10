import {expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive/headless"
import {Event, type HTMLSelectElement} from "@zavx0z/immersive"
import ResponseControlsFixture from "./fixture/response-controls"

test.each([
  {width: 354, status: "idle" as const, approvalMode: "ask" as const},
  {width: 354, status: "running" as const, approvalMode: "scoped-autonomous" as const},
  {width: 480, status: "idle" as const, approvalMode: "ask" as const},
])("кольцо и селекты одной строкой над вводом, текстовые права снизу без пересечений: $width px / $status", async ({width, status, approvalMode}) => {
  const headless = createHeadless({width, height: 600})
  try {
    const element = await headless.render(<ResponseControlsFixture status={status} approvalMode={approvalMode} onSave={() => {}} />)
    await headless.capture(element)
    const chat = element.querySelector("[data-chat-view]")!.getBoundingClientRect()
    const top = element.querySelector("[data-chat-model-settings]")!.getBoundingClientRect()
    const model = element.querySelector('[data-chat-response-setting="model"] select')!.getBoundingClientRect()
    const effort = element.querySelector('[data-chat-response-setting="thoughtLevel"] select')!.getBoundingClientRect()
    const usage = element.querySelector("[data-chat-context]")!
    const context = usage.getBoundingClientRect()
    const field = element.querySelector("textarea")!.getBoundingClientRect()
    const rights = element.querySelector("[data-chat-approval-control] button")!
    const approval = rights.getBoundingClientRect()
    const attach = element.querySelector('button[aria-label="Прикрепить файл"]')!.getBoundingClientRect()
    const send = element.querySelector(`button[aria-label="${status === "running" ? "Добавить в очередь" : "Отправить"}"]`)!.getBoundingClientRect()
    expect(model.width, "Модель имеет полноценное поле выбора").toBeGreaterThan(100)
    expect(effort.width, "Усилие имеет полноценное поле выбора").toBeGreaterThan(100)
    expect(Math.abs(model.top - effort.top), "Оба селекта находятся в одной строке").toBeLessThan(1)
    expect(model.right, "Селекты не перекрываются").toBeLessThanOrEqual(effort.left)
    expect(top.bottom, "Весь блок параметров расположен над вводом").toBeLessThanOrEqual(field.top)
    expect(Math.abs(context.top - model.top), "Кольцо выровнено с селектами").toBeLessThan(1)
    expect(context.right, "Кольцо стоит слева от модели").toBeLessThanOrEqual(model.left)
    expect(context.width).toBe(20)
    expect(context.bottom).toBeLessThanOrEqual(field.top)
    expect(usage.textContent, "Количество не занимает отдельную строку").toBe("")
    expect(usage.getAttribute("title")).toContain("50,3 к / 828,4 к")
    expect(usage.getAttribute("title")).toContain("6%")
    expect(usage.getAttribute("aria-label")).toBe(usage.getAttribute("title"))
    expect(element.querySelector('[data-chat-response-setting="model"]')!.textContent).not.toStartWith("Модель")
    expect(element.querySelector('[data-chat-response-setting="thoughtLevel"]')!.textContent).not.toStartWith("Усилие")
    expect(element.querySelectorAll("[data-chat-context]")).toHaveLength(1)
    expect(approval.top, "Текстовые права находятся под полем ввода").toBeGreaterThanOrEqual(field.bottom)
    expect(rights.textContent).toContain(approvalMode === "ask" ? "С подтверждениями" : "В пределах назначения")
    expect(approval.right, "Права не наслаиваются на прикрепление").toBeLessThanOrEqual(attach.left)
    expect(attach.right).toBeLessThanOrEqual(send.left)
    for (const bounds of [model, effort, context, field, approval, attach, send]) {
      expect(bounds.left).toBeGreaterThanOrEqual(chat.left - 1)
      expect(bounds.right).toBeLessThanOrEqual(chat.right + 1)
    }
    if (width === 354 && status === "idle") {
      await Bun.write(new URL("../../../tmp/composer-354-layout.json", import.meta.url), JSON.stringify({chat, top, model, effort, context, field, approval, attach, send}, null, 2))
      await Bun.write(new URL("../../../tmp/composer-354.png", import.meta.url), await headless.screenshot(element))
    }
  } finally {await headless.dispose()}
})

test("смена модели сбрасывает мышление и сохраняет режим подтверждений", async () => {
  const headless = createHeadless({width: 354, height: 600})
  const saved: unknown[] = []
  try {
    const element = await headless.render(<ResponseControlsFixture status="idle" approvalMode="ask" onSave={value => saved.push(value)} />)
    await headless.capture(element)
    const select = (field: string) => element.querySelector(`[data-chat-response-setting="${field}"] select`) as HTMLSelectElement
    select("model").value = "b"
    select("model").dispatchEvent(new Event("change", {bubbles: true}))
    await headless.capture(element)
    expect(select("model").value).toBe("b")
    select("thoughtLevel").value = "low"
    select("thoughtLevel").dispatchEvent(new Event("change", {bubbles: true}))
    await headless.capture(element)
    expect(select("thoughtLevel").value).toBe("low")
    expect(select("model").value).toBe("b")
    expect(saved).toEqual([
      {model: "b", approvalMode: "ask"},
      {model: "b", thoughtLevel: "low", approvalMode: "ask"},
    ])
    select("model").value = ""
    select("model").dispatchEvent(new Event("change", {bubbles: true}))
    await headless.capture(element)
    expect(saved.at(-1)).toEqual({approvalMode: "ask"})
    expect(select("model").value).toBe("")
    expect(select("model").textContent).not.toContain("· наследовать")
    expect(select("model").getAttribute("title")).toBe("Наследовать модель: GPT-6 Astra")
  } finally {await headless.dispose()}
})
