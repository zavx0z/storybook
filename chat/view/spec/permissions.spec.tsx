/** Запрос исполнителя раскрывает только предоставленные им варианты решения. */
import {afterAll, describe, expect, mock, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import type {HTMLButtonElement} from "@zavx0z/immersive-dom"
import StorybookChatView from "./fixture/history"

describe.each([{name: "Решение пользователя", error: undefined}, {name: "Ошибка исполнителя", error: "Соединение потеряно"}])("$name", async ({error}) => {
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
  describe.skipIf(error !== undefined)("Разрешение действия", () => {
    test("Выбранный вариант", () => {
      const button = element.querySelector("[data-chat-permission] button") as HTMLButtonElement
      button.click()
      expect(onPermission.mock.calls,
        "Пользовательский выбор передаёт точные идентификаторы запроса и варианта").toEqual([["permission-1", "allow-once"]])
    })
  })
})
