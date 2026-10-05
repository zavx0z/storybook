/** Проверяет обратную связь редактора с владельцем draft; native ввод и caret проверяются в Browser отдельно. */
import {expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import {InputEvent, KeyboardEvent, type HTMLTextAreaElement} from "@zavx0z/immersive-dom"
import StorybookChatView from "@zavx0z/storybook-chat-view"

/** Проверяет совместимость с legacy payload; штатный Immersive constructor не принимает keyCode. */
class LegacyImeKeyboardEvent extends KeyboardEvent {
  readonly keyCode = 229
}

test.each([
  {name: "Принятое сообщение", accepted: true},
  {name: "Отказ отправки", accepted: false},
])("$name сохраняет управляемый редактор", async ({accepted}) => {
  const headless = createHeadless({width: 400, height: 600})
  const owner = {draft: "", error: "", requests: [] as string[]}
  let update: Promise<unknown> = Promise.resolve()
  const render = () => headless.render(
    <StorybookChatView
      address="/draft"
      label="Черновик"
      messages={[]}
      draft={owner.draft}
      status="idle"
      error={owner.error}
      onDraftChange={value => {
        owner.draft = value
        update = render()
      }}
      onSend={() => {
        owner.requests.push(owner.draft)
        if (accepted) owner.draft = ""
        else owner.error = "Сообщение не принято"
        update = render()
      }}
      onCancel={() => {}}
    />,
  )
  try {
    const element = await render()
    const input = element.querySelector("textarea") as HTMLTextAreaElement
    expect(input.value, "Placeholder не является исходным значением редактора").toBe("")
    expect(input.getAttribute("placeholder"), "Подсказка задаётся отдельным атрибутом").toBe("Напишите сообщение…")
    input.focus()
    await headless.capture(element)
    expect(input.ownerDocument!.activeElement, "Обычный focus выбирает тот же semantic редактор").toBe(input)
    expect(input.getAttribute("placeholder"), "Пустой редактор при фокусе не показывает подсказку как текст ввода").toBe("")
    expect(owner.draft, "Скрытие подсказки не изменяет черновик").toBe("")
    input.blur()
    await headless.capture(element)
    expect(input.getAttribute("placeholder"), "Пустой редактор после blur снова показывает подсказку").toBe("Напишите сообщение…")
    input.focus()
    await headless.capture(element)
    input.value = "Первая строка\nВторая строка"
    input.dispatchEvent(new InputEvent("input", {bubbles: true, data: "Первая строка\nВторая строка", inputType: "insertText"}))
    await update
    expect(owner.draft, "Полный текст поступил владельцу состояния").toBe("Первая строка\nВторая строка")
    expect(element.querySelector("textarea"), "Обновление controlled props сохраняет textarea").toBe(input)
    expect(input.value, "Владелец возвращает полный draft в тот же редактор").toBe(owner.draft)
    const keyOptions = {key: "Enter", bubbles: true, cancelable: true}
    const legacyImeEvent = new LegacyImeKeyboardEvent("keydown", keyOptions)
    const guardedEvents = [
      {name: "Shift+Enter", event: new KeyboardEvent("keydown", {...keyOptions, shiftKey: true})},
      {name: "IME composition", event: new KeyboardEvent("keydown", {...keyOptions, isComposing: true})},
      {name: "IME Process", event: new KeyboardEvent("keydown", {...keyOptions, key: "Process"})},
      {name: "Legacy IME payload 229", event: legacyImeEvent},
      {name: "Повтор Enter", event: new KeyboardEvent("keydown", {...keyOptions, repeat: true})},
    ]
    expect(legacyImeEvent.keyCode, "Совместимый legacy stimulus действительно содержит keyCode 229").toBe(229)
    for (const {name, event} of guardedEvents) {
      input.dispatchEvent(event)
      expect(owner.requests, `${name} не начинает отправку`).toEqual([])
    }
    expect(owner.requests, "Shift, IME и повтор клавиши не начинают отправку").toEqual([])
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}))
    await update
    expect(owner.requests, "Enter передаёт владельцу ровно одно полное сообщение").toEqual(["Первая строка\nВторая строка"])
    expect(input.value, "Принятое сообщение очищается; отказ сохраняет исходный черновик").toBe(accepted ? "" : "Первая строка\nВторая строка")
    expect(input.getAttribute("placeholder"), "Очистка после отправки при сохранённом фокусе не возвращает подсказку").toBe("")
    expect(element.querySelector("textarea"), "Отправка сохраняет identity редактора").toBe(input)
    expect(element.querySelector('[role="alert"]')?.textContent, "Отказ не превращается в ответ агента").toBe(accepted ? undefined : "Сообщение не принято")
    if (accepted) {
      input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}))
      expect(owner.requests, "Пустое поле после очистки не отправляет второй запрос").toHaveLength(1)
    }
    input.blur()
    await headless.capture(element)
    expect(input.getAttribute("placeholder"), "При blur подсказка возвращается только в пустое поле").toBe(accepted ? "Напишите сообщение…" : "")
    expect(input.value, "Focus и blur не изменяют принятый или сохранённый текст").toBe(owner.draft)
  } finally {
    await headless.dispose()
  }
})
