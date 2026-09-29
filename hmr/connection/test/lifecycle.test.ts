import {expect, test} from "bun:test"
import createHmrConnection from "@hmr/connection"
import {FixtureSocket} from "../spec/fixture"

test("dispose отменяет ожидание и закрывает поздний результат reconnect", async () => {
  const first = new FixtureSocket()
  const next = new FixtureSocket()
  const entered = Promise.withResolvers<AbortSignal>()
  const finish = Promise.withResolvers<FixtureSocket>()
  const connection = createHmrConnection({
    socket: first,
    reconnect(signal) { entered.resolve(signal)
      return finish.promise },
    onOpen() {}, onMessage() {}, onClose() {},
  })
  first.emit("close")
  const signal = await entered.promise
  connection.dispose()
  finish.resolve(next)
  await Bun.sleep(0)
  expect(signal.aborted).toBeTrue()
  expect(first.closed).toBe(1)
  expect(next.closed).toBe(1)
  expect(next.listeners.size).toBe(0)
  connection.dispose()
  expect(first.closed).toBe(1)
})
