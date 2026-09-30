import type {HmrSocket} from "./socket"

/**
Первое соединение уже создано владельцем grant. reconnect получает новый grant
и возвращает новое соединение. onOpen повторно подписывает его на нужные темы;
onMessage не меняется при reconnect. Без reconnect связь только освобождается.
*/
export type HmrConnectionInput = Readonly<{
  socket: HmrSocket
  reconnect?(signal: AbortSignal): Promise<HmrSocket>
  onOpen(socket: HmrSocket, reconnected: boolean): void
  onMessage(event: MessageEvent): void
  onClose(): void
}>
