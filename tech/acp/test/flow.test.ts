import {expect, test} from "bun:test"
import {gatedInput, notificationFlow} from "../src/flow"

test("занятое окно updates останавливает чтение stdio до durable обработки", async () => {
  const flow = notificationFlow()
  const releases = Array.from({length: 32}, () => flow.reserve(100))
  let pulls = 0
  const input = new ReadableStream<Uint8Array>({pull(controller) { pulls += 1; controller.enqueue(new Uint8Array([pulls])) }}, {highWaterMark: 0})
  const reader = gatedInput(input, () => flow.wait()).getReader()
  let done = false
  const pending = reader.read().then(result => { done = true; return result })
  await Bun.sleep(10)
  expect(pulls).toBe(0)
  expect(done).toBeFalse()
  releases.shift()!()
  expect((await pending).value).toEqual(new Uint8Array([1]))
  expect(pulls).toBe(1)
  for (const release of releases) release()
  expect(flow.pending).toEqual({count: 0, bytes: 0})
  await reader.cancel()
})

test("байтовый предел действует независимо от числа событий, закрытие снимает ожидание", async () => {
  const flow = notificationFlow()
  const release = flow.reserve(2 * 1024 * 1024)
  let done = false
  const pending = flow.wait().then(() => { done = true })
  await Bun.sleep(10)
  expect(done).toBeFalse()
  flow.close()
  await pending
  release()
  release()
  expect(flow.pending).toEqual({count: 0, bytes: 0})
  expect(() => flow.reserve(1)).toThrow("закрыт")
})
