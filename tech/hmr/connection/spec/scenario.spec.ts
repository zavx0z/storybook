/** Подписка страницы сохраняет смысл сообщений после восстановления связи. */
import {afterAll, describe, expect, test} from "bun:test"
import createHmrConnection from "@hmr/connection"
import {FixtureSocket} from "./fixture"

describe.each([
  {name: "Соединение пакета", props: {topic: "package:@example/button"}},
  {name: "Соединение каталога", props: {topic: "registry"}},
])("$name", async ({props}) => {
  const first = new FixtureSocket()
  const next = new FixtureSocket()
  const messages: string[] = []
  const opened: boolean[] = []
  const connection = createHmrConnection({
    socket: first,
    async reconnect() { return next },
    onOpen(socket, reconnected) {
      opened.push(reconnected)
      socket.send(props.topic)
    },
    onMessage(event) { messages.push(String(event.data)) },
    onClose() {},
  })
  afterAll(() => connection.dispose())
  first.emit("open")
  first.emit("close")
  const deadline = Date.now() + 2_000
  while ((next.listeners.get("open")?.size ?? 0) === 0 && Date.now() < deadline) await Bun.sleep(10)
  next.emit("open")
  next.emit("message", "shared.updated")

  test("Повторная подписка", () => {
    expect(next.sent, "Новое соединение получает подписку того же предметного владельца").toEqual([props.topic])
  })
  test("Доставка обновления", () => {
    expect(messages, "После reconnect событие поступает действующему обработчику").toEqual(["shared.updated"])
  })
  test("Состояние связи", () => {
    expect(opened, "Первое подключение и восстановление различаются для статуса страницы").toEqual([false, true])
  })
  test("Прежнее соединение", () => {
    expect(first.closed, "Прежнее соединение закрывается после снятия обработчиков").toBe(1)
  })
})
