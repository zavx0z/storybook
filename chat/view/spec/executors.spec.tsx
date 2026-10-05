/** Выбор участников и имя нового специалиста не являются текстом задачи или параметрами модели. */
import {expect, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import {Event, InputEvent, type HTMLButtonElement, type HTMLInputElement, type HTMLSelectElement, type HTMLTextAreaElement} from "@zavx0z/immersive-dom"
import StorybookChatView, {type StorybookChatView as Contract} from "@zavx0z/storybook-chat-view"

test("выбор участника передаёт UUID и сохраняет отдельные управляемые черновики", async () => {
  const headless = createHeadless({width: 420, height: 700})
  const executors: NonNullable<Contract.Input["executors"]> = [
    {executorId: "main", executorLabel: "Главный", status: "idle", pending: []},
    {executorId: "researcher", executorLabel: "Исследователь", status: "running", pending: ["task"]},
  ]
  const drafts = new Map([["main", "Черновик главного"], ["researcher", "Вопрос исследователю"]])
  const selections: string[] = []
  let selected = "main"
  let prompts = 0
  let update: Promise<unknown> = Promise.resolve()
  const render = () => headless.render(
    <StorybookChatView
      address="/team"
      label="Команда"
      messages={[]}
      draft={drafts.get(selected) ?? ""}
      executorId={selected}
      executors={executors}
      pendingTasks={selected === "researcher" ? 1 : 0}
      status="idle"
      onSelectExecutor={id => {
        selections.push(id)
        selected = id
        update = render()
      }}
      onDraftChange={value => {
        drafts.set(selected, value)
        update = render()
      }}
      onCreateExecutor={() => {}}
      onSend={() => { prompts += 1 }}
      onCancel={() => {}}
    />,
  )
  try {
    const element = await render()
    const select = element.querySelector('[data-chat-executors] select') as HTMLSelectElement
    const editor = element.querySelector("textarea") as HTMLTextAreaElement
    select.value = "researcher"
    select.dispatchEvent(new Event("change", {bubbles: true}))
    await update
    expect(selections, "Выбор передаёт UUID, а не отображаемое имя участника").toEqual(["researcher"])
    expect(editor.value, "Выбранный участник получает свой черновик").toBe("Вопрос исследователю")
    expect(element.querySelector("[data-chat-executors]")?.textContent,
      "Количество ожидающих задач относится к выбранному участнику").toContain("Задач в очереди: 1")
    editor.value = "Уточнение исследователю"
    editor.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertText", data: "Уточнение исследователю"}))
    await update
    select.value = "main"
    select.dispatchEvent(new Event("change", {bubbles: true}))
    await update
    expect(editor.value, "Возврат сохраняет черновик главного").toBe("Черновик главного")
    expect(drafts.get("researcher"), "Изменение второго черновика не потеряно").toBe("Уточнение исследователю")
    expect(prompts, "Выбор участника не отправляет сообщение модели").toBe(0)
  } finally {
    await headless.dispose()
  }
})

test.each([
  {name: "Создание", accepted: true},
  {name: "Отказ создания", accepted: false},
])("$name специалиста блокирует повтор и сохраняет текст задачи", async ({accepted}) => {
  const headless = createHeadless({width: 420, height: 700})
  const labels: string[] = []
  let prompts = 0
  let resolveCreation!: () => void
  let rejectCreation!: (error: Error) => void
  const creation = new Promise<void>((resolve, reject) => {
    resolveCreation = resolve
    rejectCreation = reject
  })
  try {
    const element = await headless.render(
      <StorybookChatView
        address="/team"
        label="Команда"
        messages={[]}
        draft="Задача остаётся черновиком"
        executorId="main"
        executors={[{executorId: "main", executorLabel: "Главный", status: "idle", pending: []}]}
        status="idle"
        onSelectExecutor={() => {}}
        onCreateExecutor={label => {
          labels.push(label)
          return creation
        }}
        onDraftChange={() => {}}
        onSend={() => { prompts += 1 }}
        onCancel={() => {}}
      />,
    )
    const buttons = [...element.querySelectorAll("[data-chat-executors] button")] as HTMLButtonElement[]
    buttons[0]!.click()
    await headless.capture(element)
    const field = element.querySelector('[data-chat-create-executor] input') as HTMLInputElement
    field.value = "  Архитектор  "
    field.dispatchEvent(new InputEvent("input", {bubbles: true, data: "  Архитектор  ", inputType: "insertText"}))
    await headless.capture(element)
    const create = element.querySelector('[data-chat-create-executor] button') as HTMLButtonElement
    create.click()
    create.click()
    await headless.capture(element)
    expect(labels, "Два нажатия создают одну операцию с осмысленным именем").toEqual(["Архитектор"])
    expect(create.disabled, "До подтверждения повторное создание недоступно").toBeTrue()
    if (accepted) resolveCreation()
    else rejectCreation(new Error("Создание недоступно"))
    await creation.catch(() => {})
    await headless.capture(element)
    expect((element.querySelector("textarea") as HTMLTextAreaElement).value,
      "Имя специалиста и результат создания не заменяют текст задачи").toBe("Задача остаётся черновиком")
    expect(prompts, "Создание специалиста не запускает prompt").toBe(0)
    expect(element.querySelector("[data-chat-create-executor]") !== null,
      "После успеха форма закрывается, после отказа остаётся доступной").toBe(!accepted)
    expect(element.querySelector('[role="alert"]')?.textContent,
      "Отказ создания показан явной ошибкой").toBe(accepted ? undefined : "Создание недоступно")
    if (!accepted) {
      expect(field.value, "Отказ сохраняет введённое имя для повторной попытки").toBe("  Архитектор  ")
      expect(create.disabled, "Отказ освобождает блокировку создания").toBeFalse()
    }
  } finally {
    resolveCreation()
    await headless.dispose()
  }
})
