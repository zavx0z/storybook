import type {CapsuleViewerRelay} from "../src/capsule-viewer"

/** Grant одного браузерного подключения внутри server instance. */
export type BrowserSessionGrant = Readonly<{
  kind: "registry" | "package"
  packageId: string | null
  revision: string | null
  viewId: string | null
  packageGraphDigest: string | null
  intent: "reader" | "navigation-candidate" | "preview"
  preview: boolean
  allowedTopics: ReadonlySet<string>
  expiresAt: number
  release(): void
}>

/** Приватные данные WebSocket-подключения к тому же серверу. */
export type WebSocketData = {
  capsuleViewer: CapsuleViewerRelay
} | {
  subscriptions: Set<string>
  unsubscribers: Map<string, () => void>
  grant: BrowserSessionGrant
  sessionToken: string
  capsuleViewer?: never
}
