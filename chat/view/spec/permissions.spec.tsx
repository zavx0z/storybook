/** Запрос исполнителя раскрывает только предоставленные им варианты решения. */
import {afterAll, describe, expect, mock, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive/headless"
import {createRoot} from "@zavx0z/immersive/XReact"
import {createDocument, type HTMLButtonElement} from "@zavx0z/immersive"
import type {CompiledTemplate} from "@zavx0z/immersive/XReact/compiled"
import StorybookChatView from "./fixture/history"
import {ChatPermission, ChatStatus} from "../src/feedback"

describe.each([{name: "Решение пользователя", error: undefined}, {name: "Ошибка исполнителя", error: "Соединение потеряно"}])("$name", async ({name, error}) => {
  const onPermission = mock((id: string, optionId: string) => {})
  const headless = createHeadless({width: 400, height: 600})
  afterAll(() => headless.dispose())
  const element = await headless.render(
    <StorybookChatView
      address="/storybook/component"
      label="Component"
      messages={[]}
      draft="Уточни результат"
      status={error === undefined ? "running" : "failed"}
      error={error ?? ""}
      permissions={error === undefined ? [{id: "permission-1", title: "Изменить файл?", options: [{id: "allow-once", name: "Разрешить один раз"}, {id: "reject", name: "Отклонить"}]}] : []}
      onPermission={onPermission}
      onDraftChange={() => {}}
      onSend={() => {}}
      onCancel={() => {}}
    />,
  )

  test("Диагностика", () => {
    expect(element.querySelector('[role="alert"]')?.textContent,
      "Ошибка показывается из снимка сессии и не превращается в ответ ассистента").toBe(error)
  })

  /** @remarks Решение запрашивается только пока исполнитель передал ожидающий запрос. */
  describe.skipIf(name !== "Решение пользователя")("Разрешение действия", () => {
    test("Выбранный вариант", () => {
      const button = element.querySelector("[data-chat-permission] button") as HTMLButtonElement
      button.click()
      expect(onPermission.mock.calls,
        "Пользовательский выбор передаёт точные идентификаторы запроса и варианта").toEqual([["permission-1", "allow-once"]])
    })
  })
})

function permissionFixture() {
  const document = createDocument()
  const host = document.createElement("div")
  document.append(host)
  const root = createRoot(host)
  const settle = async () => {for (let turn = 0; turn < 5; turn++) {await Promise.resolve(); root.flush()}}
  return {host, root, settle}
}

test("полная команда и условия каждого варианта остаются видимым текстом, кнопки короткие", () => {
  const f = permissionFixture()
  const command = `python3 -c '${"very_long_argument_".repeat(50)}'`
  const rule = `Yes, and don't ask again for commands that start with ${command}`
  const props: Parameters<typeof ChatPermission>[0] = {
    permission: {id: "permission-full", title: "List files", toolCall: {toolCallId: "tool", rawInput: {command, cwd: "/project"}},
      options: [{id: "rule", name: rule, kind: "allow_always"}, {id: "deny", name: "No, and tell Codex what to do differently", kind: "reject_once"}]},
    onPermission() {},
  }
  try {
    f.root.render(ChatPermission as unknown as CompiledTemplate<typeof props>, props)
    f.root.flush()
    expect(f.host.querySelector("[data-permission-action]")?.textContent).toBe(JSON.stringify({command, cwd: "/project"}, null, 2))
    expect(f.host.querySelector('[data-permission-option="rule"] [data-permission-description]')?.textContent).toBe(`Разрешить и больше не спрашивать для команд с префиксом ${command}`)
    expect(f.host.querySelector('[data-permission-option="rule"] [data-permission-description]')?.getAttribute("title")).toBe(rule)
    expect(f.host.querySelector('[data-permission-option="deny"] [data-permission-description]')?.textContent).toBe("Отклонить и дать Codex другое указание")
    expect(f.host.querySelector('[data-permission-option="rule"] button')?.textContent).toBe("Разрешить")
    expect(f.host.querySelector('[data-permission-option="deny"] button')?.textContent).toBe("Отклонить")
  } finally {f.root.unmount()}
})

test("same-tick double click отправляет одно решение; отправка блокирует все варианты", async () => {
  const f = permissionFixture()
  const gate = Promise.withResolvers<void>()
  const calls: string[][] = []
  const props: Parameters<typeof ChatPermission>[0] = {permission: {id: "pending", title: "Действие",
    options: [{id: "yes", name: "Разрешить один раз", kind: "allow_once"}, {id: "no", name: "Отклонить", kind: "reject_once"}]},
    onPermission(id, optionId) {calls.push([id, optionId]); return gate.promise},
  }
  try {
    f.root.render(ChatPermission as unknown as CompiledTemplate<typeof props>, props)
    f.root.flush()
    const buttons = [...f.host.querySelectorAll("button")] as HTMLButtonElement[]
    buttons[0]!.click()
    buttons[1]!.click()
    buttons[0]!.click()
    expect(calls).toEqual([["pending", "yes"]])
    f.root.flush()
    expect(buttons.every(button => button.disabled)).toBe(true)
    expect(f.host.querySelector('[role="status"]')?.textContent).toBe("Отправляется решение…")
    gate.resolve()
    await f.settle()
    expect(f.host.querySelector('[role="status"]')).toBeNull()
  } finally {gate.resolve(); f.root.unmount()}
})

test("ошибка решения показана рядом с запросом и разрешает явную повторную попытку", async () => {
  const f = permissionFixture()
  let attempts = 0
  const props: Parameters<typeof ChatPermission>[0] = {permission: {id: "retry", title: "Действие", options: [{id: "yes", name: "Разрешить", kind: "allow_once"}]},
    async onPermission() {attempts++; if (attempts === 1) throw new Error("Соединение потеряно")},
  }
  try {
    f.root.render(ChatPermission as unknown as CompiledTemplate<typeof props>, props)
    f.root.flush()
    const button = f.host.querySelector("button") as HTMLButtonElement
    button.click()
    await f.settle()
    expect(f.host.querySelector('[role="alert"]')?.textContent).toBe("Соединение потеряно")
    expect(button.disabled).toBe(false)
    button.click()
    await f.settle()
    expect(attempts).toBe(2)
    expect(f.host.querySelector('[role="alert"]')).toBeNull()
  } finally {f.root.unmount()}
})

test("waiting и cancelling не изображаются ответом модели", () => {
  const f = permissionFixture()
  const template = ChatStatus as unknown as CompiledTemplate<Parameters<typeof ChatStatus>[0]>
  try {
    f.root.render(template, {status: "running", activity: "waiting_for_approval"})
    f.root.flush()
    expect(f.host.textContent).toBe("Ожидает вашего подтверждения")
    f.root.render(template, {status: "running", waiting: true, activity: "cancelling"})
    f.root.flush()
    expect(f.host.textContent).toBe("Останавливается…")
  } finally {f.root.unmount()}
})

test("компактная карточка читает action из единственного inline request без дублированного toolCall", () => {
  const f = permissionFixture()
  const props: Parameters<typeof ChatPermission>[0] = {permission: {id: "single-source", title: "Действие", detailsId: "permission:single-source:request",
    request: {sessionId: "native", toolCall: {toolCallId: "tool", rawInput: {command: "literal-command"}}, options: [{optionId: "once", name: "Yes, proceed", kind: "allow_once"}]},
    options: [{id: "once", name: "Yes, proceed", kind: "allow_once"}]}, onPermission() {}}
  try {
    f.root.render(ChatPermission as unknown as CompiledTemplate<typeof props>, props)
    f.root.flush()
    expect(f.host.querySelector("[data-permission-action]")?.textContent).toBe(JSON.stringify({command: "literal-command"}, null, 2))
    expect(f.host.querySelector("[data-permission-description]")?.textContent).toBe("Разрешить один раз")
  } finally {f.root.unmount()}
})
