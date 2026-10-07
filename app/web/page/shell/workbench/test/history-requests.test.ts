import {expect, test} from "bun:test"
import {createHistoryRequests} from "../src/inspector/history-requests"

test("явное действие опережает ожидающие фоновые чтения, сохраняя FIFO и общий предел", async () => {
  const read = createHistoryRequests(1)
  const gate = Promise.withResolvers<void>()
  const signal = new AbortController().signal
  const order: string[] = []
  const first = read(() => gate.promise, signal)
  const background = read(async () => {order.push("background")}, signal)
  const page = read(async () => {order.push("page")}, signal, 1)
  const action1 = read(async () => {order.push("action1")}, signal, 2)
  const action2 = read(async () => {order.push("action2")}, signal, 2)
  gate.resolve()
  await Promise.all([first, background, page, action1, action2])
  expect(order).toEqual(["action1", "action2", "page", "background"])
})

test("все вложенные истории делят четыре IO слота; отмена очереди не удерживает слот", async () => {
  const read = createHistoryRequests(4)
  let active = 0
  let peak = 0
  const release: (() => void)[] = []
  const signal = new AbortController().signal
  const tasks = Array.from({length: 12}, () => read(async () => {
    active++
    peak = Math.max(peak, active)
    await new Promise<void>(resolve => release.push(resolve))
    active--
  }, signal))
  const cancelled = new AbortController()
  const aborted = read(async () => {throw new Error("Не должно выполняться")}, cancelled.signal).catch(error => error)
  cancelled.abort(new Error("Закрыто"))
  for (let batch = 0; batch < 3; batch++) {
    await Bun.sleep(0)
    expect(active).toBe(4)
    release.splice(0).forEach(resolve => resolve())
  }
  await Promise.all(tasks)
  expect(peak).toBe(4)
  expect((await aborted).message).toBe("Закрыто")
  expect(await read(async () => 42, signal)).toBe(42)
})

test("invalid budget не создаёт вечную очередь; abort после передачи слота освобождает его", async () => {
  expect(() => createHistoryRequests(0)).toThrow("положительным")
  expect(() => createHistoryRequests(1.5)).toThrow("целым")
  const read = createHistoryRequests(1)
  const gate = Promise.withResolvers<void>()
  const first = read(() => gate.promise, new AbortController().signal)
  const controller = new AbortController()
  let executed = false
  const second = read(async () => {executed = true}, controller.signal).catch(error => error)
  gate.resolve()
  controller.abort()
  await first
  expect((await second).name).toBe("AbortError")
  expect(executed).toBe(false)
  expect(await read(async () => 42, new AbortController().signal)).toBe(42)
})
