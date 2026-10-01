import {expect, test} from "bun:test"
import {createRequestProgress} from "./progress.ts"

test("без progressToken нет request-scoped уведомлений", () => {
  expect(createRequestProgress({mcpReq: {
    signal: new AbortController().signal,
    notify: async () => { throw new Error("Уведомление не запрошено") },
  }})).toBeUndefined()
})

test("числовой token связывает фактические события, отмена прекращает уведомления", async () => {
  const abort = new AbortController()
  const notifications: unknown[] = []
  const progress = createRequestProgress({mcpReq: {
    _meta: {progressToken: 0},
    signal: abort.signal,
    notify: async notification => { notifications.push(notification) },
  }})!
  await progress("Сборка началась")
  await progress("Сборка завершилась")
  abort.abort()
  await progress("Клиент уже отсоединился")
  expect(notifications).toEqual([
    {method: "notifications/progress", params: {progressToken: 0, progress: 1, message: "Сборка началась"}},
    {method: "notifications/progress", params: {progressToken: 0, progress: 2, message: "Сборка завершилась"}},
  ])
})
