/** Беседа показывает историю, управляемый черновик и действия текущего исполнения. */
import {afterAll, describe, expect, mock, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import {Event, InputEvent, type HTMLButtonElement, type HTMLSelectElement, type HTMLTextAreaElement} from "@zavx0z/immersive-dom"
import StorybookChatView, {type StorybookChatView as Contract} from "@zavx0z/storybook-chat-view"

describe.each([
  {
    name: "Участники беседы",
    props: {
      address: "/team",
      label: "Команда предмета",
      executorId: "executor-1",
      executors: [
        {executorId: "executor-1", executorLabel: "Главный", status: "idle", pending: ["task-1"]},
        {executorId: "executor-2", executorLabel: "Исследователь", status: "running", pending: []},
      ],
      pendingTasks: 1,
      messages: [],
      draft: "",
      status: "idle",
      sending: false,
    } satisfies Omit<Contract.Input, "onDraftChange" | "onSend" | "onCancel">,
    sendEnabled: false,
    cancelEnabled: false,
    statusLabel: "Готов",
  },
  {
    name: "События и медиа",
    props: {
      address: "/timeline",
      label: "История исполнения",
      messages: [
        {id: "user-media", role: "user", text: "Посмотри изображение"},
        {id: "assistant-media", role: "assistant", text: "Изображение получено"},
      ],
      timeline: [
        {id: "user-media", kind: "message", sequence: 1, origin: "local", role: "user", content: [
          {type: "text", text: "Посмотри изображение"},
          {type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="},
        ]},
        {id: "context", kind: "context", sequence: 2, origin: "local", content: [{type: "text", text: "Переданный исходник"}]},
        {id: "thought", kind: "message", sequence: 3, origin: "live", role: "thought", content: [{type: "text", text: "Сверяю размеры"}]},
        {id: "tool", kind: "tool", sequence: 4, origin: "live", toolCallId: "read-1", call: {
          sessionUpdate: "tool_call", toolCallId: "read-1", title: "Чтение файла", status: "completed",
          content: [{type: "content", content: {type: "text", text: "Результат инструмента"}}], rawInput: {path: "image.png"},
        }, updates: []},
        {id: "event", kind: "event", sequence: 5, origin: "live", update: {sessionUpdate: "usage_update", used: 42, size: 100}},
        {id: "assistant-media", kind: "message", sequence: 6, origin: "live", role: "assistant", content: [{type: "text", text: "Изображение получено"}]},
      ],
      draft: "",
      status: "idle",
      sending: false,
    } satisfies Omit<Contract.Input, "onDraftChange" | "onSend" | "onCancel">,
    sendEnabled: false,
    cancelEnabled: false,
    statusLabel: "Готов",
  },
  {
    name: "Настройки и код",
    props: {
      address: "/settings",
      label: "Параметры агента",
      messages: [
        {id: "user-code", role: "user", text: "Покажи пример"},
        {id: "assistant-code", role: "assistant", text: "```typescript\nconst answer = 42\n```"},
      ],
      draft: "",
      status: "idle",
      sending: false,
      usage: {used: 427000, size: 828000},
      settings: [
        {id: "model", category: "model", name: "Модель", value: "a", options: [
          {value: "a", name: "Model A"},
          {value: "b", name: "Model B"},
        ]},
        {id: "effort", category: "thought_level", name: "Уровень мышления", value: "high", options: [
          {value: "low", name: "Low"},
          {value: "high", name: "High"},
        ]},
      ],
    } satisfies Omit<Contract.Input, "onDraftChange" | "onSend" | "onCancel">,
    messageText: ["Покажи пример", "const answer = 42"],
    statusLabel: "Готов",
    sendEnabled: false,
    cancelEnabled: false,
  },
  {
    name: "Длинное сообщение",
    props: {
      address: "/long",
      label: "Перенос текста",
      messages: [{id: "user-long", role: "user", text: "Длинное сообщение с переносом слов. ".repeat(20)}],
      draft: Array.from({length: 20}, (_, index) => `Строка ${index}`).join("\n"),
      status: "idle",
      sending: false,
    } satisfies Omit<Contract.Input, "onDraftChange" | "onSend" | "onCancel">,
    statusLabel: "Готов",
    sendEnabled: true,
    cancelEnabled: false,
  },
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
])("$name", async ({props, statusLabel, sendEnabled, cancelEnabled, messageText}: {
  props: Omit<Contract.Input, "onDraftChange" | "onSend" | "onCancel"> & {sending: boolean}
  statusLabel: string
  sendEnabled: boolean
  cancelEnabled: boolean
  messageText?: readonly string[]
}) => {
  const onDraftChange = mock((value: string) => {})
  const onSend = mock(() => {})
  const onCancel = mock(() => {})
  const onPrepareSettings = mock(() => {})
  const onConfigure = mock((id: string, value: string) => {})
  const onSelectExecutor = mock((id: string) => {})
  const onCreateExecutor = mock((label: string) => {})
  const headless = createHeadless({width: 400, height: 600})
  afterAll(() => headless.dispose())
  const element = await headless.render(
    <StorybookChatView
      address={props.address}
      label={props.label}
      executorId={props.executorId}
      executors={props.executors}
      pendingTasks={props.pendingTasks}
      onSelectExecutor={onSelectExecutor}
      onCreateExecutor={onCreateExecutor}
      messages={props.messages}
      timeline={props.timeline}
      draft={props.draft}
      status={props.status}
      sending={props.sending}
      usage={props.usage}
      settings={props.settings}
      onPrepareSettings={onPrepareSettings}
      onConfigure={onConfigure}
      onDraftChange={onDraftChange}
      onSend={onSend}
      onCancel={onCancel}
    />,
  )
  const send = element.querySelector('button[aria-label="Отправить"]') as HTMLButtonElement | null
  const cancel = element.querySelector('button[aria-label="Остановить"]') as HTMLButtonElement | null

  test("Предмет беседы", () => {
    expect(element.getAttribute("data-chat-address"), "Беседа относится к переданному каноническому адресу").toBe(props.address)
    expect(element.getAttribute("aria-label"), "Доступное название сохраняет предмет без лишней шапки").toBe(`Чат: ${props.label}`)
  })

  test("Состояние исполнения", () => {
    expect(element.querySelector('[data-chat-status]')?.textContent, "Пользователь видит состояние исполнения, независимо от очереди и других уведомлений").toBe(props.status === "connecting" || props.status === "running" ? statusLabel : undefined)
  })

  test("История сообщений", () => {
    expect([...element.querySelectorAll("[data-chat-message]")].map(message =>
      (message.querySelector("code") ?? message).textContent?.replace(/\s+/gu, " ").trim()),
      "Сообщения показаны в порядке владельца; код сохраняет исходный текст без Markdown-ограждения и номеров строк")
      .toEqual([...(messageText ?? props.messages.map(message => message.text.replace(/\s+/gu, " ").trim()))])
    expect([...element.querySelectorAll("[data-chat-message]")].map(message => message.getAttribute("data-chat-role")),
      "Роль каждого сообщения сохраняется в показанной истории").toEqual(props.messages.map(message => message.role))
  })

  test("Редактор сообщения", () => {
    expect(element.querySelector('[role="textbox"]')?.getAttribute("aria-multiline"),
      "Черновик редактируется настоящим многострочным textarea").toBe("true")
    expect((element.querySelector("textarea") as HTMLTextAreaElement | null)?.value,
      "Поле сообщения показывает управляемый черновик").toBe(props.draft)
  })

  test("Отправка", () => {
    if (cancelEnabled) expect(send, "Во время ответа отправка заменена остановкой").toBeNull()
    else expect(send?.disabled, "Пустой черновик и ожидание запроса не допускают отправку").toBe(!sendEnabled)
    send?.click()
    expect(onSend.mock.calls, "Разрешённая отправка передаёт действие владельцу сессии ровно один раз").toEqual(sendEnabled ? [[]] : [])
  })

  test("Отмена", () => {
    expect(cancel !== null, "Кнопка остановки существует только во время выполнения").toBe(cancelEnabled)
    cancel?.click()
    expect(onCancel.mock.calls, "Доступная отмена передаёт действие владельцу исполнения").toEqual(cancelEnabled ? [[]] : [])
  })

  /** @remarks Выбор участника доступен только при предоставленном списке исполнителей. */
  describe.skipIf(props.executors === undefined)("Участники", () => {
    test("Выбор исполнителя", () => {
      const select = element.querySelector('[data-chat-executors] select') as HTMLSelectElement
      select.value = "executor-2"
      select.dispatchEvent(new Event("change", {bubbles: true}))
      expect(onSelectExecutor.mock.calls, "Выбор передаёт ключ участника владельцу адреса").toEqual([["executor-2"]])
      expect(onSend.mock.calls, "Выбор участника не ставит задачу").toEqual([])
    })

    test("Очередь", () => {
      expect(element.querySelector("[data-chat-executors]")?.textContent,
        "Очередь показывается отдельно от состояния текущего ответа").toContain("Задач в очереди: 1")
    })
  })

  /** @remarks Богатая история предоставляет записи протокола и изображение. */
  describe.skipIf(props.timeline === undefined)("История исполнения", () => {
    test("Изображение сообщения", () => {
      expect(element.querySelector('[data-chat-image]')?.getAttribute("src"),
        "Изображение использует сохранённые данные ContentBlock в общем Document").toStartWith("data:image/png;base64,")
    })

    test("Скрытые детали", () => {
      expect([...element.querySelectorAll("[data-chat-entry]")].map(entry => entry.getAttribute("data-chat-kind")),
        "Контекст, мысль, инструмент и событие имеют отдельные записи в исходном порядке").toEqual(["context", "message", "tool", "event"])
      expect(element.querySelector("[data-chat-details]"),
        "До раскрытия содержание инструмента и контекста не создаётся").toBeNull()
    })

    test("Раскрытие инструмента", async () => {
      const tool = element.querySelector('[data-chat-entry="tool"]')!
      const button = tool.querySelector("button") as HTMLButtonElement
      button.click()
      await headless.capture(element)
      expect(tool.querySelector("[data-chat-details]")?.textContent,
        "Раскрытый инструмент показывает результат и аргументы того же вызова").toContain("Результат инструмента")
      expect(tool.querySelector('[data-chat-data="Аргументы"]')?.textContent,
        "Аргументы не восстанавливаются из обычного сообщения").toContain("image.png")
    })
  })

  /** @remarks Начальный пустой черновик даёт однозначную позицию вставки без изменения selection. */
  describe.skipIf(props.draft !== "")("Ввод сообщения", () => {
    test("Изменение управляемого черновика", () => {
      const editor = element.querySelector("textarea") as HTMLTextAreaElement
      editor.value = "Новый вопрос\nПродолжение"
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: "Новый вопрос\nПродолжение",
      }))
      expect(onDraftChange.mock.calls, "Редактор передаёт новый многострочный текст владельцу черновика").toEqual([["Новый вопрос\nПродолжение"]])
    })
  })

  /** @remarks Только вариант с настройками предоставляет модели, контекст и блок кода. */
  describe.skipIf(props.settings === undefined)("Параметры и код", () => {
    test("Заполнение контекста", () => {
      const title = element.querySelector("[data-chat-context]")?.getAttribute("title")
      expect(title, "Подсказка вычислена из переданных used и size").toContain("52%")
      expect(title, "Показаны использованные токены и размер окна").toContain("427 к / 828 к")
    })

    test("Подсветка исходника", async () => {
      await headless.capture(element)
      expect(element.querySelector('[data-language-id="typescript"]'), "Язык кода передаётся редактору").not.toBeNull()
      expect(element.querySelectorAll("[data-token-key]").length, "Код представлен синтаксическими токенами").toBeGreaterThan(0)
    })

    test("Выбор параметров", async () => {
      const button = element.querySelector('button[aria-expanded="false"]') as HTMLButtonElement
      button.click()
      await headless.capture(element)
      const selects = [...element.querySelectorAll("select")] as HTMLSelectElement[]
      expect(selects, "Выбор содержит модель и уровень мышления").toHaveLength(2)
      selects[0]!.value = "b"
      selects[0]!.dispatchEvent(new Event("change", {bubbles: true}))
      selects[1]!.value = "low"
      selects[1]!.dispatchEvent(new Event("change", {bubbles: true}))
      expect(onConfigure.mock.calls, "Выбор передаёт владельцу точные id и value").toEqual([["model", "b"], ["effort", "low"]])
      expect(onPrepareSettings.mock.calls, "Готовые настройки не требуют повторной загрузки").toEqual([])
    })
  })
})
