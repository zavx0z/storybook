import {expect, test} from "bun:test"
import createHmrConnection from "@hmr/connection"
import {FixtureSocket} from "./fixture"

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
  expect(signal.aborted, "Завершение отменяет сигнал восстановления связи").toBeTrue()
  expect(first.closed, "Исходное соединение закрывается только один раз").toBe(1)
  expect(next.closed, "Позднее соединение закрывается без подключения").toBe(1)
  expect(next.listeners.size, "После завершения обработчики не подключаются к позднему соединению").toBe(0)
  connection.dispose()
  expect(first.closed, "Исходное соединение закрывается только один раз").toBe(1)
})
