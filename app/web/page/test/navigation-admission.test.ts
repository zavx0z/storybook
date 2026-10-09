import {expect, test} from "bun:test"
import {awaitNavigationWork} from "../src/navigation-admission"

test("отмена освобождает очередь навигации до ответа transport, игнорирующего signal", async () => {
  const response = Promise.withResolvers<string>()
  const controller = new AbortController()
  const canceled = awaitNavigationWork(response.promise, controller.signal)
  controller.abort(new DOMException("Follow disabled", "AbortError"))
  await expect(canceled).rejects.toThrow("Follow disabled")
  expect(await awaitNavigationWork(Promise.resolve("manual"), new AbortController().signal)).toBe("manual")
  response.resolve("late")
  await expect(canceled).rejects.toThrow("Follow disabled")
})
