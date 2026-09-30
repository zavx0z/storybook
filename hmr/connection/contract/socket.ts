/** Минимальный публичный интерфейс соединения, включая отложенное подключение страницы. */
export type HmrSocket = Readonly<{
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
  send(data: string): void
  close(): void
}>
