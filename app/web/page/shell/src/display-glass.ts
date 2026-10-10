import {ViewPoint} from "@zavx0z/immersive/engine"
import type {Document} from "@zavx0z/immersive"
import type {DisplayElement} from "@zavx0z/immersive"
import type {ViewPointElement} from "@zavx0z/immersive"
import type {SpatialTreeSnapshot} from "@zavx0z/immersive/nodes/spatial/tree"

type FitPose = Readonly<{
  fov?: number
  position: Readonly<{x: number; y: number; z: number}>
  target: Readonly<{x: number; y: number; z: number}>
}>
type Viewport = Readonly<{width: number; height: number}>
type Selection = Pick<SpatialTreeSnapshot, "selectedId" | "nodes">

/** Совпадение с уже принятой позой fit; масштаб задаёт только числовой допуск сравнения. */
export function isStorybookDisplayFitted(viewPoint: ViewPointElement, expected: FitPose, scale: number): boolean {
  const tolerance = Math.max(1, scale) * 1e-4
  return Math.hypot(viewPoint.x - expected.position.x, viewPoint.y - expected.position.y, viewPoint.z - expected.position.z) <= tolerance
    && Math.hypot(viewPoint.targetX - expected.target.x, viewPoint.targetY - expected.target.y, viewPoint.targetZ - expected.target.z) <= tolerance
    && (expected.fov === undefined || Math.abs(viewPoint.fov - expected.fov) <= 1e-6)
}

/** Политика страницы меняет только CSS-маркер выбранного Display по событиям адреса, камеры и viewport. */
export function bindStorybookDisplayGlass(options: Readonly<{
  document: Document
  viewPoint: ViewPointElement
  baseDisplay: DisplayElement
  source: Readonly<{getSnapshot(): Selection | null; subscribe(listener: () => void): () => void}>
  displayFor(id: string): DisplayElement | null
}>) {
  let viewport: Viewport | null = null
  let baseFit: FitPose | null = null
  let baseViewport: Viewport | null = null
  let active: DisplayElement | null = null
  let focusedFit: Readonly<{node: Selection["nodes"][number]; viewport: Viewport; fov: number; pose: FitPose}> | null = null
  let disposed = false
  const mark = (display: DisplayElement | null) => {
    if (display === active) return
    active?.removeAttribute("data-storybook-display-fitted")
    active = display
    active?.setAttribute("data-storybook-display-fitted", "true")
  }
  const update = () => {
    if (disposed) return
    const snapshot = options.source.getSnapshot()
    if (snapshot === null) {
      const display = options.baseDisplay
      const viewportMatches = viewport !== null && baseViewport !== null && viewport.width === baseViewport.width && viewport.height === baseViewport.height
      mark(!display.hidden && viewportMatches && baseFit !== null && isStorybookDisplayFitted(options.viewPoint, baseFit, Math.max(display.width, display.height)) ? display : null)
      return
    }
    const node = snapshot.nodes.find(node => node.id === snapshot.selectedId)
    const display = node === undefined ? null : options.displayFor(node.id)
    if (node === undefined || display === null || viewport === null || display.hidden) {
      mark(null)
      return
    }
    const rect = node.rect
    if (focusedFit === null || focusedFit.node !== node || focusedFit.fov !== options.viewPoint.fov
      || focusedFit.viewport.width !== viewport.width || focusedFit.viewport.height !== viewport.height) {
      // Тот же публичный fit и те же границы, что использует SpatialTree при focus выбранного адреса.
      focusedFit = {node, viewport, fov: options.viewPoint.fov, pose: ViewPoint.fitPoseForBounds({
        min: {x: rect.x, y: rect.y, z: rect.z - .001},
        max: {x: rect.x + rect.width, y: rect.y + rect.height, z: rect.z},
      }, {x: 0, y: 0, z: 1}, {fov: options.viewPoint.fov, aspect: viewport.width / viewport.height})}
    }
    mark(isStorybookDisplayFitted(options.viewPoint, focusedFit.pose, Math.max(rect.width, rect.height)) ? display : null)
  }
  const unsubscribeSelection = options.source.subscribe(update)
  const unsubscribeCamera = options.document.subscribeMutations(batch => {
    if (batch.records.some(record => record.target === options.viewPoint)) update()
  })
  return {
    update,
    updateViewport(next: Viewport) {
      if (viewport?.width === next.width && viewport.height === next.height) return
      viewport = next
      update()
    },
    setBaseFit(pose: FitPose) {
      baseFit = pose
      baseViewport = viewport
      update()
    },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribeSelection()
      unsubscribeCamera()
      mark(null)
    },
  }
}
