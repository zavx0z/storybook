/**
Сохраняет обработчики обновлений при восстановлении связи страницы с сервером.
Владелец transport получает новый grant при каждом reconnect. Компонент владеет
listeners, отменой и задержкой повторной попытки, а смысл сообщений остаётся
у получателя. Подписка не запрашивает компиляцию.
Входной контракт описывает callbacks; socket доступен через тип
{@link StorybookTechHmrConnection.Input} без отдельного публичного экспорта.
@packageDocumentation
*/
import type {StorybookTechHmrConnection} from "./contract"
export type {StorybookTechHmrConnection} from "./contract"

/**
Подключает обработчики к socket и восстанавливает подписку после повторного соединения.

@param input - Socket и callbacks владельца согласно {@link StorybookTechHmrConnection.Input}.

@returns Lifecycle соединения, который завершается через {@link StorybookTechHmrConnection.Output.dispose}.

@example
```ts
const connection = createHmrConnection({socket, reconnect, onOpen, onMessage, onClose})
try {
  await waitForPageUpdates()
} finally {
  connection.dispose()
}
```
*/
export default function createHmrConnection(input: StorybookTechHmrConnection.Input): StorybookTechHmrConnection.Output {
  const lifetime = new AbortController()
  let socket = input.socket
  let delay = 250
  let reconnecting = false
  let pending = false
  let timer: ReturnType<typeof setTimeout> | null = null

  /** При открытии сбрасывает задержку и передаёт соединение для повторной подписки. */
  const onOpen = (): void => {
    if (lifetime.signal.aborted) return
    delay = 250
    input.onOpen(socket, reconnecting)
  }
  /** Передаёт события владельцу только до завершения lifecycle. */
  const onMessage = (event: MessageEvent): void => {
    if (!lifetime.signal.aborted) input.onMessage(event)
  }
  /** Снимает принадлежащие lifecycle обработчики перед закрытием socket. */
  const detach = (value: StorybookTechHmrConnection.Input["socket"]): void => {
    value.removeEventListener("open", onOpen)
    value.removeEventListener("message", onMessage)
    value.removeEventListener("close", onClose)
  }
  /** Подключает те же обработчики к текущему socket. */
  const attach = (): void => {
    socket.addEventListener("open", onOpen)
    socket.addEventListener("message", onMessage)
    socket.addEventListener("close", onClose)
  }
  /** Планирует единственную повторную попытку; отказ увеличивает задержку до двух секунд. */
  const onClose = (): void => {
    if (lifetime.signal.aborted || timer !== null || pending) return
    reconnecting = true
    input.onClose()
    if (input.reconnect === undefined) return
    timer = setTimeout(() => {
      timer = null
      pending = true
      void Promise.resolve().then(() => input.reconnect!(lifetime.signal)).then(next => {
        if (lifetime.signal.aborted) {
          next.close()
          return
        }
        detach(socket)
        socket.close()
        socket = next
        attach()
      }).catch(() => {
        delay = Math.min(2_000, delay * 2)
        pending = false
        onClose()
      }).finally(() => { pending = false })
    }, delay)
  }
  attach()
  return Object.freeze({
    dispose() {
      if (lifetime.signal.aborted) return
      lifetime.abort(new DOMException("HMR connection disposed", "AbortError"))
      if (timer !== null) clearTimeout(timer)
      detach(socket)
      socket.close()
    },
  })
}
