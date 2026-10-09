/** Публичный ChatView показывает bounded snapshot беседы; действия возвращаются владельцу состояния. */
import {afterAll, describe, expect, mock, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import {readFile} from "node:fs/promises"
import type {HTMLButtonElement} from "@zavx0z/immersive-dom"
import type {StorybookChatHistory} from "@zavx0z/storybook-chat-history"
import StorybookChatView, {type StorybookChatView as Contract} from "@zavx0z/storybook-chat-view"
import {fixtureHistory} from "./fixture/history-data"
import {installScenarioImageEncoder, scenarioImageData, scenarioImageSource, scenarioMediaHost} from "./fixture/scenario-media"

type Item = StorybookChatHistory.Output[number]
type ScenarioData = Pick<Contract.Input, "address" | "label" | "draft" | "status"> & Partial<Pick<Contract.Input, "sending" | "usage" | "settings" | "executorId" | "pendingTasks" | "media">> & Readonly<{
  messages: readonly Readonly<{id: string, role: "user" | "assistant" | "system", text: string}>[]
  timeline?: readonly Item[]
}>
const restoreEncoder = installScenarioImageEncoder()
afterAll(restoreEncoder)

describe.each([
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
          {type: "image", mimeType: "image/png", data: scenarioImageData},
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
    } satisfies ScenarioData,
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
    } satisfies ScenarioData,
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
    } satisfies ScenarioData,
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
    } satisfies ScenarioData,
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
    } satisfies ScenarioData,
    statusLabel: "Работает…",
    sendEnabled: true,
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
    } satisfies ScenarioData,
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
    } satisfies ScenarioData,
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
    } satisfies ScenarioData,
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
    } satisfies ScenarioData,
    statusLabel: "Отправка сообщения…",
    sendEnabled: false,
    cancelEnabled: false,
  },
  {
    name: "Markdown и изображения",
    props: {
      address: "/media-fixture", label: "Изображения", draft: "", status: "idle", sending: false,
      messages: [{id: "typed", role: "user", text: "Прикреплённое изображение"},
        {id: "markdown", role: "assistant", text: `Текст перед изображением.\n\n![Проверка Markdown](${scenarioImageSource})\n\nТекст после изображения.`}],
      timeline: [
        {id: "typed", sequence: 1, kind: "message", origin: "local", role: "user", content: [{type: "text", text: "Прикреплённое изображение"}, {type: "image", mimeType: "image/png", data: scenarioImageData}]},
        {id: "markdown", sequence: 2, kind: "message", origin: "live", role: "assistant", content: [{type: "text", text: `Текст перед изображением.\n\n![Проверка Markdown](${scenarioImageSource})\n\nТекст после изображения.`}]},
      ],
    } satisfies ScenarioData,
    sendEnabled: false, cancelEnabled: false, statusLabel: "Готов",
  },
  {
    name: "Развёрнутое изображение",
    props: {
      address: "/media-fixture", label: "Предпросмотр", draft: "", status: "idle", sending: false,
      messages: [{id: "preview", role: "assistant", text: "Статичный предпросмотр исходного PNG"}],
      media: {source: scenarioImageSource, mimeType: "image/png", label: "Проверка Markdown"},
    } satisfies ScenarioData,
    sendEnabled: false, cancelEnabled: false, statusLabel: "Готов",
  },
  {
    name: "Изображение и длинная история",
    props: {
      address: "/media-scroll", label: "Прокрутка изображений", draft: "", status: "idle", sending: false,
      messages: Array.from({length: 24}, (_, index) => ({id: `scroll:${index}`, role: "assistant" as const,
        text: index === 0 ? `![Проверка Markdown](${scenarioImageSource})` : `Сообщение ${index}. Обычный текст истории для прокрутки. `.repeat(4)})),
    } satisfies ScenarioData,
    sendEnabled: false, cancelEnabled: false, statusLabel: "Готов",
  },
])("$name", async ({name, props, statusLabel, sendEnabled, cancelEnabled}) => {
  const headless = createHeadless({width: 420, height: 640})
  afterAll(() => headless.dispose())
  const onDraftChange = mock((value: string) => {})
  const onSend = mock(() => {})
  const onCancel = mock(() => {})
  const onHistoryExpand = mock((id: string, expanded: boolean) => {})
  const onMedia = mock((value: Parameters<NonNullable<Contract.Input["onMedia"]>>[0]) => {})
  const onConfigure = mock((id: string, value: string) => {})
  const onPrepareSettings = mock(() => {})
  const mediaHost = scenarioMediaHost()
  afterAll(() => mediaHost.images?.dispose())
  const history = fixtureHistory(props.messages, "timeline" in props ? props.timeline : undefined)
  const element = await headless.render(
    <StorybookChatView
      address={props.address}
      label={props.label}
      history={history}
      draft={props.draft}
      status={props.status}
      sending={props.sending}
      usage={"usage" in props ? props.usage : undefined}
      settings={"settings" in props ? props.settings : undefined}
      media={"media" in props ? props.media : undefined}
      mediaHost={mediaHost}
      onDraftChange={onDraftChange}
      onSend={onSend}
      onCancel={onCancel}
      onHistoryViewport={() => {}}
      onHistoryVisible={() => {}}
      onHistoryExpand={onHistoryExpand}
      onHistoryRetry={() => {}}
      onHistoryEvidence={() => {}}
      onHistoryTail={() => {}}
      onPrepareSettings={onPrepareSettings}
      onConfigure={onConfigure}
      onMedia={onMedia}
    />,
  )

  test("Предмет беседы", () => {
    expect(element.querySelector("[data-chat-view]")?.getAttribute("data-chat-address"), "Представление сохраняет адрес владельца snapshot").toBe(props.address)
    expect(element.getAttribute("aria-label"), "Беседа имеет доступное имя своего предмета").toBe(`Чат: ${props.label}`)
  })
  test("Состояние исполнения", () => {
    expect(element.querySelector("[data-chat-status]")?.textContent, "Индикатор показывает переданное состояние исполнения").toBe(props.status === "connecting" || props.status === "running" ? statusLabel : undefined)
  })
  test("История сообщений", () => {
    expect(element.querySelectorAll("[data-chat-message]").length, "Обычные сообщения остаются в порядке ограниченного snapshot").toBe(props.messages.length)
  })
  test("Редактор сообщения", () => {
    const editor = element.querySelector("textarea")
    expect(editor?.getAttribute("aria-label"), "Редактор черновика имеет доступное имя").toBe("Сообщение")
  })
  test("Отправка", () => {
    const button = element.querySelector(props.status === "running" ? 'button[aria-label="Добавить в очередь"]' : 'button[aria-label="Отправить"]') as HTMLButtonElement
    expect(button.disabled, "Доступность определяется черновиком и состоянием исполнения").toBe(!sendEnabled)
    button.click()
    expect(onSend.mock.calls, "Отправка сообщает владельцу намерение ровно один раз").toEqual(sendEnabled ? [[]] : [])
  })
  test("Отмена", () => {
    const button = element.querySelector('button[aria-label="Остановить"]') as HTMLButtonElement | null
    expect(button !== null, "Подключение и исполнение предоставляют действие отмены").toBe(cancelEnabled)
    button?.click()
    expect(onCancel.mock.calls, "Отмена передаётся владельцу исполнения").toEqual(cancelEnabled ? [[]] : [])
  })

  /** @remarks Только вариант с timeline содержит отдельный инструмент и исходный typed image. */
  describe.skipIf(!["События и медиа", "Markdown и изображения"].includes(name))("События и изображения", () => {
    test("Исходный PNG", async () => {
      const file = await readFile(new URL("./fixture/circle.png", import.meta.url))
      expect(Buffer.from(scenarioImageData, "base64"), "Переносимые данные сохраняют byte-identical PNG asset сценария").toEqual(file)
    })
    test("Изображение сообщения", async () => {
      await headless.capture(element)
      const image = element.querySelector('[data-chat-image]')
      expect(image?.getAttribute("src"), "Изображение проходит public media preparation и получает bounded blob").toStartWith("blob:")
      expect(image?.getAttribute("width"), "Исходный fixture PNG декодируется с шириной240px").toBe("240")
      expect(image?.getAttribute("height"), "Исходный fixture PNG декодируется с высотой240px").toBe("240")
    })
  })
  /** @remarks Только timeline варианта событий содержит свернутый tool с действием раскрытия. */
  describe.skipIf(name !== "События и медиа")("Действия исполнения", () => {
    test("Раскрытие инструмента", () => {
      const entry = element.querySelector('[data-chat-entry="tool"]')!
      const button = entry.querySelector("button") as HTMLButtonElement
      button.click()
      expect(onHistoryExpand.mock.calls, "Раскрытие запрашивает новый snapshot у владельца истории").toEqual([["tool", true]])
    })
  })
  /** @remarks Раскрытое media является отдельным состоянием владельца, а не внутренним состоянием ChatView. */
  describe.skipIf(name !== "Развёрнутое изображение")("Развёрнутое изображение", () => {
    test("Предпросмотр", async () => {
      await headless.capture(element)
      expect(element.querySelector('[role="dialog"]')?.getAttribute("aria-label"), "Диалог относится к выбранному изображению владельца").toBe("Проверка Markdown")
      expect(element.querySelector('[data-chat-full-image]')?.getAttribute("src"), "Развёрнутое изображение подготовлено штатным image pipeline").toStartWith("blob:")
    })
    test("Закрытие", () => {
      const button = element.querySelector('button[aria-label="Закрыть медиа"]') as HTMLButtonElement
      button.click()
      expect(onMedia.mock.calls, "Закрытие возвращает владельцу состояние без выбранного media").toEqual([[null]])
    })
  })
  /** @remarks Только вариант с assistant Markdown image предоставляет действие открытия именно этого source. */
  describe.skipIf(!["Markdown и изображения", "Изображение и длинная история"].includes(name))("Markdown изображения", () => {
    test("Содержимое и действие", async () => {
      await headless.capture(element)
      const button = element.querySelector('button[aria-label="Открыть: Проверка Markdown"]') as HTMLButtonElement | null
      // Длинная история начинает с tail; её image появляется после scroll и проверяется в live view.
      if (props.messages.length > 20) {
        expect(props.messages[0]?.text, "История содержит исходный Markdown image до длинного хвоста").toBe(`![Проверка Markdown](${scenarioImageSource})`)
        return
      }
      expect(button, "Markdown image сохраняет alt в доступной команде открытия").not.toBeNull()
      button!.click()
      expect(onMedia.mock.calls[0]?.[0]?.source, "Команда передаёт исходный URI через public onMedia").toBe(scenarioImageSource)
    })
  })
})
