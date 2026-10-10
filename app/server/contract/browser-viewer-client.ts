/** Клиент signaling relay выбранного viewer; медиа остаётся прямым WebRTC. */
export type BrowserViewerClient = Readonly<{
  send(value: string): unknown
  close(code?: number, reason?: string): void
  getBufferedAmount(): number
}>
