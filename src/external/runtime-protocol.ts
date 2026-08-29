import type {
  Document as SemanticDocument,
  Node as SemanticNode,
} from "@zavx0z/dom"
import type {Space} from "@engine/core"

/** Exact structural marker implemented by executable owner runtimes. */
export const STORYBOOK_RUNTIME_PROTOCOL = "storybook-runtime/1" as const

/** One loaded story operation inside an exact package-tab realm. */
export type StorybookRuntimeStoryInput = Readonly<{
  route: string
  story: unknown
  signal: AbortSignal
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
  space: Space
  camera: StorybookWorldPreviewCamera
  cameraGestures?: boolean
  resize?(viewport: StorybookWorldPreviewViewport): void
  onDoubleClick?(): void
}>

/** Narrow owner handle; the shared Renderer and page Space remain private. */
export type StorybookWorldPreview = Readonly<{
  readonly frames: number
  readonly disposed: boolean
  requestRender(): void
  resetViewPoint(): void
  dispose(): void
}>

/** Host capabilities supplied by the external Storybook shell. */
export type StorybookRuntimeContext = Readonly<{
  document: SemanticDocument
  browserDocument: globalThis.Document
  canvas: HTMLCanvasElement
  signal: AbortSignal
  mount(node: SemanticNode): void
  publishInspector(value: unknown): void
  publishSource(value: unknown): void
  publishProps(value: unknown): void
  reportDiagnostic(value: unknown): void
  requestRender(): void
  subscribePreviewBounds(listener: (bounds: StorybookPreviewBounds | null) => void): () => void
  mountWorldPreview(registration: StorybookWorldPreviewRegistration): StorybookWorldPreview
}>

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
  styleSheets?: readonly string[]
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
  const styleSheets = readProperty(session, "styleSheets", "Storybook runtime session")
  if (styleSheets !== undefined && (!Array.isArray(styleSheets) ||
    styleSheets.some((sheet) => typeof sheet !== "string"))) {
    throw new TypeError("Storybook runtime session.styleSheets must be a string list when provided")
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
