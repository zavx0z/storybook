import type {CapsuleRtcIceConfiguration} from "@capsule/webrtc/ice"

/**
Предпросмотр выбранного executor использует только identity участника и профиля,
без remote URL. Адрес и credentials остаются у Provider host.

@property describe - Возвращает instance, профиль и действительное право управления
из авторизованного Provider peer adapter. Signal ограничивает подготовку.

@property socket - Создаёт WebSocket-подобный peer stream для существующего
ограниченного signaling relay. Состояния соответствуют WebSocket; send передаёт
только строковый signaling frame. Close освобождает свою линию, сохраняя сеть.
*/
export type BrowserViewerPeerAdapter = Readonly<{
  /** Необязательная выдача свежей ICE-конфигурации самим удалённым исполнителем. */
  configuration?(input: {peerId: string, executorId: string, instanceId: string, signal: AbortSignal}): Promise<CapsuleRtcIceConfiguration>
  describe(input: {peerId: string, executorId: string, signal: AbortSignal}): Promise<Readonly<{
    instanceId: string
    profile: string
    controlEnabled: boolean
  }>>
  socket(input: {peerId: string, executorId: string, instanceId: string, viewerPeerId: string}): Readonly<{
    readyState: number
    bufferedAmount: number
    send(payload: string): unknown
    close(code?: number, reason?: string): unknown
    addEventListener(type: "open" | "message" | "close" | "error", listener: (event: any) => void): void
  }>
}>
