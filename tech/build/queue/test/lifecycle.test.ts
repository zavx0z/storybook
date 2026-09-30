import {expect, test} from "bun:test"
import BuildQueue from "@build/queue"

test("очередь изолирует данные разных владельцев и завершает отмену перед следующим допуском", async () => {
  const queue = new BuildQueue<{label: string}>({limit: 1})
  const controller = new AbortController()
  let cleanup!: () => void
  const cleaned = new Promise<void>(resolve => { cleanup = resolve })
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const first = queue.run({operationId: "first", details: {label: "first"}}, async context => {
    entered()
    await new Promise<void>(resolve => context.signal.addEventListener("abort", () => resolve(), {once: true}))
    await cleaned
    context.signal.throwIfAborted()
  }, controller.signal)
  await started
  let secondEntered = false
  const second = queue.run({operationId: "second", details: {label: "second"}}, async context => {
    secondEntered = true
    context.setDetails({label: "готово"})
    return 42
  }, new AbortController().signal)
  controller.abort(new DOMException("cancel", "AbortError"))
  expect(queue.snapshot().active[0]?.state).toBe("canceling")
  expect(secondEntered).toBeFalse()
  cleanup()
  await expect(first).rejects.toThrow("cancel")
  expect(await second).toBe(42)
  expect(queue.snapshot().recent.map(item => [item.operationId, item.details.label, item.outcome])).toEqual([
    ["second", "готово", "completed"], ["first", "first", "canceled"],
  ])
  queue.dispose()
})

test("закрытие очереди отклоняет ожидания и сохраняет lifecycle допущенной работы", async () => {
  const queue = new BuildQueue<{}>()
  const admitted = await queue.acquire({details: {}}, new AbortController().signal)
  const waiting = queue.run({details: {}}, async () => 42, new AbortController().signal)
  queue.dispose()
  await expect(waiting).rejects.toThrow("disposed")
  expect(queue.active).toBe(1)
  admitted.finish("completed")
  admitted.finish("completed")
  expect(queue.active).toBe(0)
  expect(queue.snapshot().recent.map(item => item.outcome)).toEqual(["completed", "canceled"])
  await expect(queue.run({details: {}}, async () => 1, new AbortController().signal)).rejects.toThrow("disposed")
})

test("ошибка бюджета владельца сохраняет timeout без знания предметной диагностики", async () => {
  const failure = {budget: "exhausted"}
  const queue = new BuildQueue<{}>({isTimeout: error => error === failure})
  await expect(queue.run({details: {}}, async () => { throw failure }, new AbortController().signal)).rejects.toBe(failure)
  expect(queue.snapshot().recent[0]?.outcome).toBe("timed-out")
  queue.dispose()
})
