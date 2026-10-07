/** Управление отправкой и параметры агента используют реальные события общего Document. */
import {afterAll, expect, mock, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import {Event, KeyboardEvent, type HTMLButtonElement, type HTMLSelectElement, type HTMLTextAreaElement} from "@zavx0z/immersive-dom"
import StorybookChatView from "./fixture/history"

const headless = createHeadless({width: 360, height: 680})
afterAll(() => headless.dispose())

test("селект модели доступен над вводом и снимает override без открытия меню прав", async () => {
  const prepare = mock(() => {})
  const change = mock((value: unknown) => {})
  const element = await headless.render(<StorybookChatView
    address="/" label="Project" messages={[]} draft="" status="idle"
    settings={[{id: "model", category: "model", name: "Модель", value: "fast", options: [{value: "fast", name: "Fast"}]}]}
    execution={{selection: {model: "fast", thoughtLevel: "high"}, executorSelection: {}, effective: {connectionId: "codex", model: "fast"},
      sources: {connectionId: "general", model: "session"}, connections: [{id: "codex", provider: "codex", label: "Codex", enabled: true}]}}
    onPrepareSettings={prepare} onExecutionChange={change}
    onDraftChange={() => {}} onSend={() => {}} onCancel={() => {}}
  />)
  await headless.capture(element)
  expect(element.querySelectorAll("select")).toHaveLength(3)
  const model = element.querySelector('[data-chat-response-setting="model"] select') as HTMLSelectElement
  model.value = ""
  model.dispatchEvent(new Event("change", {bubbles: true}))
  expect(change.mock.calls).toEqual([[{}]])
  const rights = element.querySelector('button[aria-expanded="false"]') as HTMLButtonElement
  rights.click()
  await headless.capture(element)
  expect(prepare.mock.calls).toEqual([])
  expect(element.querySelector("[data-chat-settings]")).not.toBeNull()
})

test("Enter отправляет, Shift+Enter и IME сохраняют ввод; круглая кнопка имеет доступное имя", async () => {
  const send = mock(() => {})
  const element = await headless.render(
    <StorybookChatView
      address="/"
      label="Project"
      messages={[]}
      draft="Сообщение"
      status="idle"
      onDraftChange={() => {}}
      onSend={send}
      onCancel={() => {}}
    />,
  )
  const input = element.querySelector("textarea") as HTMLTextAreaElement
  for (const options of [{shiftKey: true}, {isComposing: true}]) {
    const event = new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true, ...options})
    input.dispatchEvent(event)
    expect(event.defaultPrevented).toBeFalse()
  }
  expect(send).not.toHaveBeenCalled()
  const enter = new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true})
  input.dispatchEvent(enter)
  expect(enter.defaultPrevented).toBeTrue()
  expect(send).toHaveBeenCalledTimes(1)
  const button = element.querySelector('button[aria-label="Отправить"]') as HTMLButtonElement
  expect(button.querySelector("img")).not.toBeNull()
  expect(element.querySelector('button[aria-label="Остановить"]')).toBeNull()
})

test("настройки показывают только варианты агента, tooltip содержит реальный контекст, код использует подсветку", async () => {
  const change = mock((id: string, value: string) => {})
  const prepare = mock(() => {})
  const element = await headless.render(
    <StorybookChatView
      address="/"
      label="Project"
      messages={[
        {id: "user", role: "user", text: "Покажи пример"},
        {id: "assistant", role: "assistant", text: "Пример:\n\n```typescript\nconst answer = 42\n```"},
      ]}
      draft=""
      status="idle"
      usage={{used: 427000, size: 828000}}
      settings={[
        {id: "model", category: "model", name: "Model", value: "a", options: [{value: "a", name: "Model A"}, {value: "b", name: "Model B"}]},
        {id: "effort", category: "thought_level", name: "Thinking", value: "high", options: [{value: "low", name: "Low"}, {value: "high", name: "High"}]},
      ]}
      onPrepareSettings={prepare}
      onConfigure={change}
      onDraftChange={() => {}}
      onSend={() => {}}
      onCancel={() => {}}
    />,
  )
  const context = element.querySelector("[data-chat-context]")!
  expect(context.getAttribute("title")).toContain("52%")
  expect(context.getAttribute("title")).toContain("427 к / 828 к")
  expect(element.querySelector('[data-chat-role="user"]')).not.toBeNull()
  await headless.capture(element)
  expect(element.querySelector('[data-language-id="typescript"]')).not.toBeNull()
  expect(element.querySelectorAll("[data-token-key]").length, "Код содержит цветные синтаксические токены").toBeGreaterThan(0)
  const row = element.querySelector('[data-chat-role="user"]')!.getBoundingClientRect()
  const bubble = element.querySelector('[data-message-bubble="self"]')!.getBoundingClientRect()
  expect(bubble.width, "Плашка вмещает текст, а не только padding").toBeGreaterThan(40)
  expect(bubble.x, "Короткое сообщение располагается справа").toBeGreaterThan(row.x)
  expect(Math.abs(bubble.right - row.right)).toBeLessThan(1)
  const selects = [...element.querySelectorAll("[data-chat-model-settings] select")] as HTMLSelectElement[]
  expect(selects).toHaveLength(2)
  selects[0]!.value = "b"
  selects[0]!.dispatchEvent(new Event("change", {bubbles: true}))
  expect(change.mock.calls).toEqual([["model", "b"]])
  expect(prepare).not.toHaveBeenCalled()
})

test("длинное сообщение переносится, textarea растёт до лимита и не теряет исходный текст", async () => {
  const draft = Array.from({length: 20}, (_, i) => `Строка ${i}`).join("\n")
  const element = await headless.render(
    <StorybookChatView
      address="/long"
      label="Long chat"
      messages={[{id: "long", role: "user", text: "Длинное сообщение с переносом слов. ".repeat(20)}]}
      draft={draft}
      status="idle"
      onDraftChange={() => {}}
      onSend={() => {}}
      onCancel={() => {}}
    />,
  )
  await headless.capture(element)
  const input = element.querySelector("textarea") as HTMLTextAreaElement
  expect(input.value).toBe(draft)
  expect(input.getBoundingClientRect().height).toBe(180)
  const bubble = element.querySelector('[data-message-bubble="self"]')!.getBoundingClientRect()
  const row = element.querySelector('[data-chat-role="user"]')!.getBoundingClientRect()
  expect(bubble.height).toBeGreaterThan(60)
  expect(bubble.width).toBeLessThanOrEqual(row.width * 0.9 + 1)
})


test.each([{width: 400, height: 700}, {width: 360, height: 300}])("меню настроек остаётся в видимой области $width×$height", async ({width, height}) => {
  const host = createHeadless({width, height})
  try {
    const element = await host.render(<StorybookChatView
      address="/menu-layout"
      label="Беседа"
      messages={[]}
      draft=""
      status="idle"
      settings={[{id: "model", category: "model", name: "Модель", value: "a", options: [{value: "a", name: "Модель A"}]}]}
      onPrepareSettings={() => {}}
      onDraftChange={() => {}}
      onSend={() => {}}
      onCancel={() => {}}
    />)
    const button = element.querySelector('button[aria-expanded="false"]') as HTMLButtonElement
    button.click()
    await host.capture(element)
    const chat = element.querySelector("[data-chat-view]")!.getBoundingClientRect()
    const menu = element.querySelector("[data-chat-settings]")!.getBoundingClientRect()
    expect(menu.height, "Меню имеет доступную область содержимого").toBeGreaterThan(30)
    expect(menu.top, "Меню не выходит выше обрезающей области чата").toBeGreaterThanOrEqual(chat.top - 1)
    expect(menu.bottom, "Меню не выходит ниже чата").toBeLessThanOrEqual(chat.bottom + 1)
    expect(menu.right).toBeLessThanOrEqual(chat.right + 1)
    expect(element.querySelector('button[aria-label="Закрыть настройки"]')).not.toBeNull()
  } finally {await host.dispose()}
})


test.each([{name: "Новая беседа", pinnedConnectionId: undefined}, {name: "Native беседа", pinnedConnectionId: "codex"}])(
  "провайдер $name выбирается только до закрепления native сессии",
  async ({pinnedConnectionId}) => {
    const change = mock((value: unknown) => {})
    const element = await headless.render(<StorybookChatView
      address="/providers"
      label="Провайдеры"
      messages={[]}
      draft=""
      status="idle"
      settings={[{id: "model", category: "model", name: "Модель", value: "fast", options: [{value: "fast", name: "Fast"}]}]}
      execution={{
        selection: {connectionId: "codex", model: "fast", thoughtLevel: "high", approvalMode: "ask"},
        executorSelection: {},
        effective: {connectionId: "codex", model: "fast"},
        sources: {connectionId: "session", model: "session"},
        ...(pinnedConnectionId === undefined ? {} : {pinnedConnectionId}),
        connections: [
          {id: "codex", provider: "codex", label: "Codex", enabled: true},
          {id: "ollama", provider: "ollama", label: "Ollama", enabled: true, endpoint: {url: "http://localhost:11434"}},
        ],
      }}
      onExecutionChange={change}
      onDraftChange={() => {}}
      onSend={() => {}}
      onCancel={() => {}}
    />)
    await headless.capture(element)
    const selects = element.querySelectorAll("[data-chat-model-settings] select")
    expect(selects).toHaveLength(3)
    const provider = selects[0] as HTMLSelectElement
    expect(provider.querySelectorAll('option[value="codex"]')).toHaveLength(1)
    expect(provider.querySelectorAll('option[value="ollama"]')).toHaveLength(1)
    expect(provider.disabled).toBe(pinnedConnectionId !== undefined)
    provider.value = "ollama"
    provider.dispatchEvent(new Event("change", {bubbles: true}))
    expect(change.mock.calls).toEqual(pinnedConnectionId === undefined
      ? [[{connectionId: "ollama", approvalMode: "ask"}]] : [])
    const thought = element.querySelector('[data-chat-response-setting="thoughtLevel"] select') as HTMLSelectElement
    expect(thought.disabled, "Отсутствующий thought capability не подменяется сохранённым усилием Codex").toBe(true)
    expect(thought.textContent).not.toContain("Высокое")
  },
)
