export type StorybookBrowserInteractionTarget = Readonly<{
  nodeId?: string | undefined
  role?: string | undefined
  name?: string | undefined
}>

export type StorybookBrowserInteractionValue =
  | string
  | number
  | Readonly<{key: string; modifiers?: readonly ("alt" | "ctrl" | "meta" | "shift")[] | undefined}>
  | Readonly<{text: string}>
  | Readonly<{deltaY: number; deltaX?: number | undefined; deltaZ?: number | undefined}>
  | Readonly<{dx: number; dy: number}>

export type StorybookBrowserInteractInput = Readonly<{
  viewId: string
  target?: StorybookBrowserInteractionTarget | undefined
  action: "hover" | "focus" | "click" | "pointerDown" | "pointerUp" | "drag" | "key" | "type" | "wheel" | "scenario"
  value?: StorybookBrowserInteractionValue | undefined
  destination?: Readonly<{nodeId: string}> | undefined
  timeoutMs?: number | undefined
}>

export type StorybookBrowserCaptureInput = Readonly<{
  viewId?: string | undefined
  area: "page" | "workbench" | "preview" | "canvas" | "node"
  nodeId?: string | undefined
  failOnConsoleError?: boolean | undefined
  timeoutMs?: number | undefined
}>

export type ChromeTargetSummary = Readonly<{
  targetId: string
  type: string
  title: string
  url: string
}>

export type StorybookBridgeIdentity = Readonly<{
  protocol: "external-storybook-agent-bridge/1"
  packageId: string
  route: string
  revision: string | null
  graphDigest: string | null
  ready: boolean
  presented: boolean
  timeOrigin: number
}>

export type StorybookBridgeClip = Readonly<{
  x: number
  y: number
  width: number
  height: number
  scale?: number
}>

export type StorybookBridgeMethod = "identity" | "inspect" | "interact" | "capture"

export type StorybookInternalView = Readonly<{
  viewId: string
  targetId: string
  origin: string
  packageId: string
  route: string
  url: string
  title: string
}>

export type StorybookPublicView = Readonly<{
  viewId: string
  packageId: string
  route: string
  title: string
}>

export type StorybookChromeConsoleEntry = Readonly<{
  type?: string
  level?: string
  text?: string
  url?: string
  line?: number
  timestamp?: number
}>

export interface StorybookChromeClient {
  health(signal?: AbortSignal): Promise<void>
  cdpOrigin(signal?: AbortSignal): Promise<string>
  browserIdentity(signal?: AbortSignal): Promise<string>
  targets(signal?: AbortSignal): Promise<readonly ChromeTargetSummary[]>
  createTarget(url: string, signal?: AbortSignal): Promise<ChromeTargetSummary>
  closeTarget(targetId: string, signal?: AbortSignal): Promise<void>
  navigate(targetId: string, url: string, signal?: AbortSignal): Promise<void>
  waitReady(targetId: string, timeoutMs: number, signal?: AbortSignal): Promise<void>
  consoleEntries(targetId: string, durationMs: number, signal?: AbortSignal): Promise<readonly StorybookChromeConsoleEntry[]>
  bridgeDiagnostics(targetId: string, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>>
  callBridge(targetId: string, method: StorybookBridgeMethod, params: unknown, signal?: AbortSignal): Promise<unknown>
  screenshot(
    targetId: string,
    options: Readonly<{caption: string; clip?: StorybookBridgeClip; timeoutMs?: number}>,
    signal?: AbortSignal,
  ): Promise<Uint8Array>
}

export type StorybookProcessStart = (pid: number) => string | null

export type StorybookCaptureArea = "page" | "workbench" | "preview" | "canvas" | "node"

export type StorybookCaptureMetadata = Readonly<{
  packageId: string
  route: string
  graphDigest: string
  revision: string
  area: StorybookCaptureArea
  nodeId?: string
  consoleErrors: readonly unknown[]
}>

export type StoredStorybookCapture = StorybookCaptureMetadata & Readonly<{
  captureId: string
  resourceUri: string
  mimeType: "image/png"
  width: number
  height: number
  bytes: number
  sha256: string
  capturedAt: string
}>
