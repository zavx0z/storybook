import type {Document, HTMLElement, Node} from "@zavx0z/immersive-dom"
import type {Presentation, RootProjection} from "@zavx0z/immersive-browser/integration"

/** Возможности существующей оболочки, необходимые для диагностики и доставки общего ввода. */
export type Shell = Readonly<{
  document: Document
  browserDocument: globalThis.Document
  canvas: HTMLCanvasElement
  root: Pick<Presentation, "input">
  space: Node
  workbench: Readonly<{
    element: HTMLElement
    elements: Readonly<{previewHost: HTMLElement}>
    controller?: Readonly<{
      selectedInspector?(): string | null
      read?(path: "inspector.subject"): Readonly<{workspaceId?: string}> | null
    }>
  }>
  readonly presentedFrameSequence: number
  readonly followEnvironment?: boolean
  projectionFor(node: Node): RootProjection
  presentFrame(): number
  dispatchNativeKey(target: HTMLElement, input: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">): void
  dispatchNativeText(target: HTMLElement, text: string): boolean
}>
