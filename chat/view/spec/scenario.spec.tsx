/** Беседа показывает историю, управляемый черновик и действия текущего исполнения. */
import {afterAll, describe, expect, mock, test} from "bun:test"
import {createHeadless} from "@immersive/headless"
import {InputEvent, type HTMLButtonElement} from "@zavx0z/dom"
import ChatView, {type ChatView as Contract} from "@chat/view"

describe.each([
  {
    name: "Готовая беседа",
    props: {
      address: "/storybook/component",
      label: "Component",
      messages: [
        {id: "user-1", role: "user", text: "Проверь контракт"},
        {id: "assistant-1", role: "assistant", text: "Нужен конкретный пример.\nПроверим его."},
      ],
      draft: "Первая строка\nВторая строка",
      status: "idle",
      sending: false,
    } satisfies Omit<Contract.Input, "onDraftChange" | "onSend" | "onCancel">,
    statusLabel: "Готов",
    sendEnabled: true,
    cancelEnabled: false,
  },
  {
    name: "Ответ исполняется",
    props: {
      address: "/",
      label: "Project",
      messages: [{id: "assistant-1", role: "assistant", text: "Исследую существующий API…"}],
      draft: "Следующий вопрос",
      status: "running",
      sending: false,
    } satisfies Omit<Contract.Input, "onDraftChange" | "onSend" | "onCancel">,
    statusLabel: "Отвечает…",
    sendEnabled: false,
    cancelEnabled: true,
  },
  {
    name: "Подключение исполнителя",
    props: {
      address: "/storybook",
      label: "Storybook",
      messages: [],
      draft: "Проверь проект",
      status: "connecting",
      sending: false,
    } satisfies Omit<Contract.Input, "onDraftChange" | "onSend" | "onCancel">,
    statusLabel: "Подключение…",
    sendEnabled: false,
    cancelEnabled: true,
  },
  {
    name: "Новая беседа",
    props: {
      address: "/storybook/repo",
      label: "Repo",
      messages: [],
      draft: "",
      status: "idle",
      sending: false,
    } satisfies Omit<Contract.Input, "onDraftChange" | "onSend" | "onCancel">,
    statusLabel: "Готов",
    sendEnabled: false,
    cancelEnabled: false,
  },
  {
    name: "Пробельный черновик",
    props: {
      address: "/storybook/repo",
      label: "Repo",
      messages: [],
      draft: " \n ",
      status: "idle",
      sending: false,
    } satisfies Omit<Contract.Input, "onDraftChange" | "onSend" | "onCancel">,
    statusLabel: "Готов",
    sendEnabled: false,
    cancelEnabled: false,
  },
  {
    name: "Отправка запроса",
    props: {
      address: "/storybook/repo",
      label: "Repo",
      messages: [],
      draft: "Вопрос отправляется",
      status: "idle",
      sending: true,
    } satisfies Omit<Contract.Input, "onDraftChange" | "onSend" | "onCancel">,
    statusLabel: "Отправка сообщения…",
    sendEnabled: false,
    cancelEnabled: false,
  },
])("$name", async ({props, statusLabel, sendEnabled, cancelEnabled}) => {
  const onDraftChange = mock((value: string) => {})
  const onSend = mock(() => {})
  const onCancel = mock(() => {})
  const headless = createHeadless({width: 400, height: 600})
  afterAll(() => headless.dispose())
  const element = await headless.render(
    <ChatView
      address={props.address}
      label={props.label}
      messages={props.messages}
      draft={props.draft}
      status={props.status}
      sending={props.sending}
      onDraftChange={onDraftChange}
      onSend={onSend}
      onCancel={onCancel}
    />,
  )
  const send = [...element.querySelectorAll("button")].find(button => button.textContent === "Отправить") as HTMLButtonElement
  const cancel = [...element.querySelectorAll("button")].find(button => button.textContent === "Остановить") as HTMLButtonElement

  test("Предмет беседы", () => {
    expect(element.getAttribute("data-chat-address"), "Беседа относится к переданному каноническому адресу").toBe(props.address)
    expect(element.querySelector("header strong")?.textContent, "Шапка показывает название текущего предмета").toBe(props.label)
  })

  test("Состояние исполнения", () => {
    expect(element.querySelector('[role="status"]')?.textContent, "Пользователь видит подключение, готовность или исполнение").toBe(statusLabel)
  })

  test("История сообщений", () => {
    expect([...element.querySelectorAll("[data-chat-message-text]")].map(message => message.textContent),
      "Тексты показаны в порядке владельца с сохранением переносов строк").toEqual(props.messages.map(message => message.text))
    expect([...element.querySelectorAll("[data-chat-message]")].map(message => message.getAttribute("data-chat-role")),
      "Роль каждого сообщения сохраняется в показанной истории").toEqual(props.messages.map(message => message.role))
  })

  test("Редактор сообщения", () => {
    expect(element.querySelector('[role="textbox"]')?.getAttribute("aria-multiline"),
      "Черновик редактируется настоящим многострочным CodeEditor").toBe("true")
    expect(element.querySelector('[data-language-id="plaintext"]'),
      "Сообщение использует текстовый режим без языка программирования").not.toBeNull()
  })

  test("Отправка", () => {
    expect(send.disabled, "Пустой черновик и текущее выполнение не допускают отправку").toBe(!sendEnabled)
    send.click()
    expect(onSend.mock.calls, "Разрешённая отправка передаёт действие владельцу сессии ровно один раз").toEqual(sendEnabled ? [[]] : [])
  })

  test("Отмена", () => {
    expect(cancel.disabled, "Остановить можно подключение или текущее выполнение").toBe(!cancelEnabled)
    cancel.click()
    expect(onCancel.mock.calls, "Доступная отмена передаёт действие владельцу исполнения").toEqual(cancelEnabled ? [[]] : [])
  })

  /** @remarks Начальный пустой черновик даёт однозначную позицию вставки без изменения selection. */
  describe.skipIf(props.draft !== "")("Ввод сообщения", () => {
    test("Изменение управляемого черновика", () => {
      const editor = element.querySelector('[role="textbox"]')!
      editor.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: "Новый вопрос\nПродолжение",
      }))
      expect(onDraftChange.mock.calls, "Редактор передаёт новый многострочный текст владельцу черновика").toEqual([["Новый вопрос\nПродолжение"]])
    })
  })
})
