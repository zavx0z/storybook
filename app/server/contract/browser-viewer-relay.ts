import type {BrowserViewerClient} from "./browser-viewer-client"

/** Signaling выбранного владельца через public server WebSocket; upstream является peer stream либо native socket. */
export type BrowserViewerRelay = Readonly<{
  attach(client: BrowserViewerClient): void
  message(value: string | Uint8Array): void
  close(): Promise<void>
}>
