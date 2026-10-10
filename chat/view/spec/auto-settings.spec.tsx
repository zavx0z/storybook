import {expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive/headless"
import {InputEvent, KeyboardEvent, type HTMLButtonElement, type HTMLTextAreaElement} from "@zavx0z/immersive"
import AutoSettingsFixture from "./fixture/auto-settings"

test("cold354px: auto prepare once, одна строка, локальная загрузка без блокировки текста и вложений", async () => {
  const headless = createHeadless({width: 354, height: 600})
  const response = Promise.withResolvers<void>()
  let prepares = 0
  let sends = 0
  let attached = 0
  try {
    const element = await headless.render(<AutoSettingsFixture status="idle" response={response.promise} onPrepare={() => {prepares++}} onSend={() => {sends++}} onAttach={() => {attached++}} />)
    await headless.capture(element)
    const top = element.querySelector("[data-chat-model-settings]")!
    const topBounds = top.getBoundingClientRect()
    const composer = element.querySelector("[data-chat-composer]")!.getBoundingClientRect()
    expect(prepares).toBe(1)
    expect(element.querySelector("[data-chat-status]"), "Подготовка параметров не выдаётся за ответ модели").toBeNull()
    expect(top.querySelectorAll("button")).toHaveLength(0)
    expect(topBounds.height, "Нет дополнительной строки загрузки").toBeLessThanOrEqual(24)
    expect(composer.top - topBounds.bottom).toBe(8)
    expect(top.querySelectorAll("select")).toHaveLength(2)
    for (const select of top.querySelectorAll("select")) {
      expect(select.textContent).toContain("Загрузка…")
      expect(select.getAttribute("title")).toBe("Подключение к исполнителю…")
    }
    const textarea = element.querySelector("textarea") as HTMLTextAreaElement
    textarea.value = "Продолжаю писать"
    textarea.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: textarea.value}))
    await headless.capture(element)
    expect(textarea.value).toBe("Продолжаю писать")
    const attach = element.querySelector('button[aria-label="Прикрепить файл"]') as HTMLButtonElement
    expect(attach.disabled).toBe(false)
    attach.click()
    expect(attached).toBe(1)
    textarea.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}))
    expect(sends).toBe(0)
    expect((element.querySelector('button[aria-label="Отправить"]') as HTMLButtonElement).disabled).toBe(true)
    await headless.capture(element)
    expect(prepares).toBe(1)
    response.resolve()
    await headless.capture(element)
    await headless.capture(element)
    expect(top.textContent).not.toContain("Загрузка…")
    expect(textarea.value).toBe("Продолжаю писать")
    expect((element.querySelector('button[aria-label="Отправить"]') as HTMLButtonElement).disabled).toBe(false)
    expect(element.querySelector("[data-chat-model-settings]")!.getBoundingClientRect().height).toBe(topBounds.height)
    expect(prepares).toBe(1)
  } finally {response.resolve(); await headless.dispose()}
})

test("ошибка autoload не создаёт retry loop; повтор доступен только отдельным действием в error state", async () => {
  const headless = createHeadless({width: 354, height: 600})
  const response = Promise.withResolvers<void>()
  let prepares = 0
  try {
    const element = await headless.render(<AutoSettingsFixture status="idle" response={response.promise} onPrepare={() => {prepares++}} onSend={() => {}} onAttach={() => {}} />)
    await headless.capture(element)
    response.reject(new Error("Исполнитель недоступен"))
    for (let turn = 0; turn < 3; turn++) await headless.capture(element)
    expect(prepares).toBe(1)
    const error = element.querySelector('[role="alert"]')!
    expect(error.textContent).toContain("Исполнитель недоступен")
    expect(element.querySelector("[data-chat-model-settings]")!.querySelectorAll("button")).toHaveLength(0)
    const retry = error.querySelector("button") as HTMLButtonElement
    expect(retry.textContent).toBe("Повторить загрузку параметров")
    retry.click()
    for (let turn = 0; turn < 3; turn++) await headless.capture(element)
    expect(prepares).toBe(2)
  } finally {response.resolve(); await headless.dispose()}
})

test.each([0, 2])("failed с pending=%s не вызывает auto prepare; явный retry различает параметры и очередь", async pending => {
  const headless = createHeadless({width: 354, height: 600})
  const response = Promise.withResolvers<void>()
  let prepares = 0
  try {
    const element = await headless.render(<AutoSettingsFixture status="failed" pendingTasks={pending} initialError="Ошибка подключения" response={response.promise} onPrepare={() => {prepares++}} onSend={() => {}} onAttach={() => {}} />)
    for (let turn = 0; turn < 3; turn++) await headless.capture(element)
    expect(prepares).toBe(0)
    const buttons = [...element.querySelectorAll("button")].map(button => button.textContent)
    expect(buttons.includes("Повторить загрузку параметров")).toBe(pending === 0)
    expect(buttons.includes("Повторить подключение и продолжить очередь")).toBe(pending > 0)
  } finally {response.resolve(); await headless.dispose()}
})
