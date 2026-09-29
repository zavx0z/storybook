/**
Сохраняет обработчики обновлений при восстановлении связи страницы с сервером.
Владелец transport получает новый grant при каждом reconnect. Компонент владеет
listeners, отменой и задержкой повторной попытки, а смысл сообщений остаётся
у получателя. Подписка не запрашивает компиляцию.
@packageDocumentation
*/
import type {HmrConnectionInput, HmrSocket} from "./contract/input"
import type {HmrConnectionOutput} from "./contract/output"
export type {HmrConnectionInput, HmrSocket} from "./contract/input"
export type {HmrConnectionOutput} from "./contract/output"

/** Подключает обработчики к первому socket и восстанавливает их до dispose. */
export default function createHmrConnection(input: HmrConnectionInput): HmrConnectionOutput {
  const lifetime = new AbortController()
  let socket = input.socket
  let delay = 250
  let reconnecting = false
  let pending = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const onOpen = (): void => {
    if (lifetime.signal.aborted) return
    delay = 250
    input.onOpen(socket, reconnecting)
  }
  const onMessage = (event: MessageEvent): void => {
    if (!lifetime.signal.aborted) input.onMessage(event)
  }
  const detach = (value: HmrSocket): void => {
    value.removeEventListener("open", onOpen)
    value.removeEventListener("message", onMessage)
    value.removeEventListener("close", onClose)
  }
  const attach = (): void => {
    socket.addEventListener("open", onOpen)
    socket.addEventListener("message", onMessage)
    socket.addEventListener("close", onClose)
  }
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
