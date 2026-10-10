import {type Document as SemanticDocument} from "@zavx0z/immersive"
import {type ViewPointElement} from "@zavx0z/immersive"

import type {StorybookPreviewBounds, StorybookSpacePreviewCamera} from "../contract/preview.ts"

import type {StorybookViewPointSnapshot} from "./types"

export const EXTERNAL_STORYBOOK_CANVAS_ID = "external-storybook-canvas" as const

export const EXTERNAL_STORYBOOK_DISPLAY_ID = "external-storybook-display" as const

export const EXTERNAL_STORYBOOK_WORKBENCH_ID = "external-storybook-workbench" as const

export const spaceViewPointSnapshot = (
  camera: StorybookSpacePreviewCamera,
): StorybookViewPointSnapshot => Object.freeze({
  position: Object.freeze({...camera.position}),
  target: Object.freeze({...camera.target}),
  fov: camera.fov ?? Math.PI / 4,
  near: camera.near ?? 1,
  far: camera.far ?? 2_000,
})

export function canvasPixelRatio(
  canvas: HTMLCanvasElement,
  bounds: StorybookPreviewBounds,
): number {
  const width = Number(canvas.width)
  const ratio = width > 0 && bounds.viewportWidth > 0
    ? width / bounds.viewportWidth
    : 1
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

export function readViewPointSnapshot(viewPoint: ViewPointElement): StorybookViewPointSnapshot {
  return Object.freeze({
    position: Object.freeze({x: viewPoint.x, y: viewPoint.y, z: viewPoint.z}),
    target: Object.freeze({
      x: viewPoint.targetX,
      y: viewPoint.targetY,
      z: viewPoint.targetZ,
    }),
    fov: viewPoint.fov,
    near: viewPoint.near,
    far: viewPoint.far,
  })
}

export function writeViewPointSnapshot(
  document: SemanticDocument,
  viewPoint: ViewPointElement,
  snapshot: StorybookViewPointSnapshot,
): void {
  document.transaction(() => {
    viewPoint.x = snapshot.position.x
    viewPoint.y = snapshot.position.y
    viewPoint.z = snapshot.position.z
    viewPoint.targetX = snapshot.target.x
    viewPoint.targetY = snapshot.target.y
    viewPoint.targetZ = snapshot.target.z
    viewPoint.fov = snapshot.fov
    viewPoint.near = snapshot.near
    viewPoint.far = snapshot.far
  })
}

export function ensureCanvas(document: globalThis.Document): HTMLCanvasElement {
  const existing = document.getElementById(EXTERNAL_STORYBOOK_CANVAS_ID)
  if (existing !== null) {
    if (!(existing instanceof HTMLCanvasElement)) {
      throw new Error(`${EXTERNAL_STORYBOOK_CANVAS_ID} is not a canvas`)
    }
    return existing
  }
  const canvas = document.createElement("canvas")
  canvas.id = EXTERNAL_STORYBOOK_CANVAS_ID
  canvas.tabIndex = 0
  if (document.body === null) throw new Error("External Storybook document.body is unavailable")
  document.body.appendChild(canvas)
  return canvas
}

export function sameBounds(
  left: StorybookPreviewBounds | null,
  right: StorybookPreviewBounds | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function assertActive(disposed: boolean): void {
  if (disposed) throw new Error("External Storybook shell is disposed")
}

export function markShellPhase(document: globalThis.Document, phase: string): void {
  const root = document.documentElement
  if (root !== undefined && root !== null && root.dataset !== undefined) {
    root.dataset.externalStorybookShellPhase = phase
  }
}
