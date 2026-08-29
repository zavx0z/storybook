export const STORYBOOK_MCP_SCHEMA_VERSION = 1 as const

export type StorybookOperationStatus = "success" | "failed" | "timeout" | "unavailable"

export type StorybookControllerResult = Readonly<{
  status: StorybookOperationStatus
  [key: string]: unknown
}>

export type StorybookEnsureInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  roots?: readonly string[] | undefined
}>

export type StorybookStatusInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  scope?: string | undefined
  includeViews?: boolean | undefined
}>

export type StorybookAttachInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  root: string
}>

export type StorybookDetachInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  scopeId: string
}>

export type StorybookSearchInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  query: string
  packageId?: string | undefined
  kinds?: readonly ("workspace" | "project" | "package" | "category" | "subject" | "variant")[] | undefined
  limit?: number | undefined
  cursor?: string | undefined
}>

export type StorybookOpenInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  packageId: string
  route?: string | undefined
}>

export type StorybookWaitInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  packageId?: string | undefined
  viewId?: string | undefined
  afterRevision?: string | undefined
  condition: "built" | "active" | "ready" | "presented" | "failed"
  timeoutMs?: number | undefined
}>

export type StorybookInspectInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  viewId: string
  include?: readonly ("state" | "diagnostics" | "console" | "semantic" | "layout" | "display" | "canvases")[] | undefined
  maxDepth?: number | undefined
  limit?: number | undefined
  cursor?: string | undefined
}>

export type StorybookInteractionTarget = Readonly<{
  nodeId?: string | undefined
  role?: string | undefined
  name?: string | undefined
}>

export type StorybookInteractionValue =
  | string
  | number
  | Readonly<{key: string; modifiers?: readonly ("alt" | "ctrl" | "meta" | "shift")[] | undefined}>
  | Readonly<{text: string}>
  | Readonly<{deltaY: number; deltaX?: number | undefined; deltaZ?: number | undefined}>
  | Readonly<{dx: number; dy: number}>

export type StorybookInteractInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  viewId: string
  target?: StorybookInteractionTarget | undefined
  action: "hover" | "focus" | "click" | "pointerDown" | "pointerUp" | "drag" | "key" | "type" | "wheel" | "scenario"
  value?: StorybookInteractionValue | undefined
  destination?: Readonly<{nodeId: string}> | undefined
  timeoutMs?: number | undefined
}>

export type StorybookCaptureInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  viewId?: string | undefined
  packageId?: string | undefined
  route?: string | undefined
  area: "page" | "workbench" | "preview" | "canvas" | "node"
  nodeId?: string | undefined
  failOnConsoleError?: boolean | undefined
  timeoutMs?: number | undefined
}>

export type StorybookCheckInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  scope: string
  live?: boolean | undefined
  timeoutMs?: number | undefined
}>

export type StorybookCloseInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  viewId: string
}>

export type StorybookStopInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  confirm: true
}>

export type StorybookCaptureImage = Readonly<{
  data: string
  mimeType: "image/png"
}>

export type StorybookCaptureResult = StorybookControllerResult & Readonly<{
  image?: StorybookCaptureImage
}>

export type StorybookResourceResult = Readonly<{
  status: StorybookOperationStatus
  uri: string
  mimeType: string
  text?: string
  blob?: string
  error?: Readonly<{code: string; message: string}>
}>

export type StorybookControllerContext = Readonly<{
  signal: AbortSignal
}>

/** Shared application boundary implemented by the external Storybook core. */
export interface ExternalStorybookController {
  ensure(input: StorybookEnsureInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  status(input: StorybookStatusInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  attach(input: StorybookAttachInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  detach(input: StorybookDetachInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  search(input: StorybookSearchInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  open(input: StorybookOpenInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  wait(input: StorybookWaitInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  inspect(input: StorybookInspectInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  interact(input: StorybookInteractInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  capture(input: StorybookCaptureInput, context: StorybookControllerContext): Promise<StorybookCaptureResult>
  check(input: StorybookCheckInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  close(input: StorybookCloseInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  stop(input: StorybookStopInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  readResource(uri: string, context: StorybookControllerContext): Promise<StorybookResourceResult>
}

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
