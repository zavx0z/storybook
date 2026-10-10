import type {BrowserViewerClient} from "./browser-viewer-client"

/** Signaling выбранного владельца внутри данных публичного серверного WebSocket. */
export type BrowserViewerRelay = Readonly<{
  attach(client: BrowserViewerClient): void
  message(value: string | Uint8Array): void
  close(): Promise<void>
}>
