/** Уведомления MCP привязаны к токену одного запроса и его отмене. */
import {describe, expect, test} from "bun:test"
import createRequestProgress from "@zavx0z/storybook-tech-mcp-progress"

describe.each([
  {name: "Числовой token", props: {progressToken: 0}},
  {name: "Строковый token", props: {progressToken: "compile-1"}},
])("$name", async ({props}) => {
  const abort = new AbortController()
  const notifications: unknown[] = []
  const progress = createRequestProgress({mcpReq: {
    _meta: {progressToken: props.progressToken},
    signal: abort.signal,
    notify: async notification => { notifications.push(notification) },
  }})!
  await progress("Подготовка")
  await progress("Готово")
  abort.abort()
  await progress("После отмены")

  test("События работы", () => {
    expect(notifications, "Один запрос нумерует доставленные стадии последовательно; отмена прекращает отправку").toEqual([
      {method: "notifications/progress", params: {progressToken: props.progressToken, progress: 1, message: "Подготовка"}},
      {method: "notifications/progress", params: {progressToken: props.progressToken, progress: 2, message: "Готово"}},
    ])
  })
})
