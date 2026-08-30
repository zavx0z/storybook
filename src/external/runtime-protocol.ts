import type {
  Document as SemanticDocument,
  Node as SemanticNode,
} from "@zavx0z/dom"
import type {Space} from "@engine/core"
import type {StorybookRuntimeStyleSheetRoot} from "./browser/source-projection.ts"

/** Exact structural marker implemented by executable owner runtimes. */
export const STORYBOOK_RUNTIME_PROTOCOL = "storybook-runtime/3" as const
export const STORYBOOK_PRESENTATION_PROTOCOL = "story-presentation/1" as const

/** One loaded story operation inside an exact package-tab realm. */
export type StorybookRuntimeStoryInput = Readonly<{
  route: string
  story: unknown
  signal: AbortSignal
}>

export type StorybookRuntimeSourceInput = Readonly<{
  html: string
  typescript: string
}>

/** One atomic owner presentation published for the current mount/update. */
export type StorybookRuntimePresentationInput = Readonly<{
  protocol: typeof STORYBOOK_PRESENTATION_PROTOCOL
  node: SemanticNode
  componentRoot: StorybookRuntimeStyleSheetRoot
  source: StorybookRuntimeSourceInput
  values?: Readonly<Record<string, unknown>>
}>

/** Camera preset for one owner world projected inside the shared page Experience. */
export type StorybookWorldPreviewCamera = Readonly<{
  position: Readonly<{x: number; y: number; z: number}>
  target: Readonly<{x: number; y: number; z: number}>
  up?: Readonly<{x: number; y: number; z: number}>
  fov?: number
  near?: number
  far?: number
}>

/** Exact logical and framebuffer extent owned by one bounded world preview. */
export type StorybookWorldPreviewViewport = Readonly<{
  x: number
  y: number
  width: number
  height: number
  backingX: number
  backingY: number
  backingWidth: number
  backingHeight: number
  pixelRatio: number
}>

/** Atomic semantic anchor plus direct Engine world presentation. */
export type StorybookWorldPreviewRegistration = Readonly<{
  node: SemanticNode
  camera: StorybookWorldPreviewCamera
  cameraGestures?: boolean
  resize?(viewport: StorybookWorldPreviewViewport): void
  onDoubleClick?(): void
}>

/** Narrow camera/frame handle; Renderer stays private and Space comes only from world context. */
export type StorybookWorldPreview = Readonly<{
  readonly frames: number
  readonly disposed: boolean
  requestRender(): void
  resetViewPoint(): void
  dispose(): void
}>

/** Capabilities shared by every declaration-governed presentation context. */
export type StorybookRuntimeContextBase = Readonly<{
  document: SemanticDocument
  signal: AbortSignal
  present(value: StorybookRuntimePresentationInput): void
  reportDiagnostic(value: unknown): void
  requestRender(): void
}>

/** DOM or HUD projection. Engine Space ownership is intentionally absent. */
export type StorybookComponentRuntimeContext = StorybookRuntimeContextBase & Readonly<{
  projection: "display" | "hud"
}>

/** Declared Engine/world projection on the one Experience Space and ViewPoint. */
export type StorybookWorldRuntimeContext = StorybookRuntimeContextBase & Readonly<{
  projection: "world"
  space: Space
  mountWorldPreview(registration: StorybookWorldPreviewRegistration): StorybookWorldPreview
}>

/** Exact context union selected from the owning subject declaration. */
export type StorybookRuntimeContext =
  | StorybookComponentRuntimeContext
  | StorybookWorldRuntimeContext

export type StorybookPreviewBounds = Readonly<{
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
}>

/** Package-owned execution session. Navigation and registry state stay external. */
export type StorybookRuntimeSession = Readonly<{
  mount(input: StorybookRuntimeStoryInput): void | Promise<void>
  update?(input: StorybookRuntimeStoryInput): void | Promise<void>
  unmount(): void | Promise<void>
  dispose(): void | Promise<void>
}>

/** Plain structural adapter exported by an executable owner package. */
export type StorybookRuntimeAdapter = Readonly<{
  protocol: typeof STORYBOOK_RUNTIME_PROTOCOL
  create(
    context: StorybookRuntimeContext,
  ): StorybookRuntimeSession | Promise<StorybookRuntimeSession>
}>

/**
Validates an owner runtime without relying on a shared consumer type identity.

The consumer module is already loaded when this check runs. The validator only
accepts the exact protocol marker and callable session factory; incompatible
objects fail before they can receive package-tab host capabilities.
*/
export function validateStorybookRuntimeAdapter(value: unknown): StorybookRuntimeAdapter {
  const runtime = requireObject(value, "Storybook runtime")
  const protocol = readProperty(runtime, "protocol", "Storybook runtime")
  if (protocol !== STORYBOOK_RUNTIME_PROTOCOL) {
    throw new TypeError(
      `Unsupported Storybook runtime protocol: ${describeValue(protocol)}`,
    )
  }
  requireMethod(runtime, "create", "Storybook runtime")
  return runtime as StorybookRuntimeAdapter
}

/**
Validates the execution session returned by `runtime.create(context)`.

`update` is optional. Every other lifecycle operation is required so the host
can always replace a story, unmount it and dispose the package realm cleanly.
*/
export function validateStorybookRuntimeSession(value: unknown): StorybookRuntimeSession {
  const session = requireObject(value, "Storybook runtime session")
  if (Object.hasOwn(session, "styleSheets")) {
    throw new TypeError("Storybook runtime session.styleSheets is not supported; declare authorStyleSheets or use compiled component CSS")
  }
  requireMethod(session, "mount", "Storybook runtime session")
  const update = readProperty(session, "update", "Storybook runtime session")
  if (update !== undefined && typeof update !== "function") {
    throw new TypeError("Storybook runtime session.update must be a function when provided")
  }
  requireMethod(session, "unmount", "Storybook runtime session")
  requireMethod(session, "dispose", "Storybook runtime session")
  return session as StorybookRuntimeSession
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireMethod(
  value: Record<string, unknown>,
  key: string,
  label: string,
): void {
  if (typeof readProperty(value, key, label) !== "function") {
    throw new TypeError(`${label}.${key} must be a function`)
  }
}

function readProperty(
  value: Record<string, unknown>,
  key: string,
  label: string,
): unknown {
  try {
    return value[key]
  } catch (error) {
    throw new TypeError(`${label}.${key} could not be read`, {cause: error})
  }
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value)
  return String(value)
}
