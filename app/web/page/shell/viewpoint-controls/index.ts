/**
Управляет общим ViewPoint существующего Experience, сохраняя его lifecycle.
UI получает snapshot и команды; persistence передаётся принимающей оболочкой.

@packageDocumentation
*/
import type {StorybookAppWebPageShellViewpointControls} from "./contract"
export type {StorybookAppWebPageShellViewpointControls} from "./contract"
import type {ViewPointElement} from "@immersive/dom/viewpoint"

/** Управляет единственным semantic ViewPoint; UI получает только состояние и команды. */
export default function createViewPointControls(persistence?: StorybookAppWebPageShellViewpointControls.Input): StorybookAppWebPageShellViewpointControls.Output {
  let restored = false
  let camera: ViewPointElement | null = null
  let fit = () => {}
  let unsubscribe = () => {}
  let disposed = false
  let snapshot: Readonly<{ready: boolean; frozen: boolean}> = Object.freeze({ready: false, frozen: true})
  const listeners = new Set<() => void>()
  const publish = () => {
    const next = {ready: camera !== null && !disposed, frozen: !camera?.controls}
    if (snapshot.ready === next.ready && snapshot.frozen === next.frozen) return
    snapshot = Object.freeze(next)
    for (const listener of listeners) listener()
  }
  return Object.freeze({
    initialPosition: persistence?.state.position ?? {edge: "top" as const, offset: .5},
    savePosition: persistence?.savePosition ?? (() => {}),
    restoreCamera() {
      if (restored || !camera) return
      persistence?.restoreCamera(camera)
      restored = true
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    bind(viewPoint: ViewPointElement, fitView: () => void, canSaveCamera: () => boolean = () => true) {
      if (disposed) throw new Error("ViewPoint controls are disposed")
      unsubscribe()
      camera = viewPoint
      fit = fitView
      if (persistence?.state.frozen !== undefined) camera.controls = !persistence.state.frozen
      unsubscribe = viewPoint.ownerDocument!.subscribeMutations(batch => {
        if (batch.records.some(record => record.target === viewPoint)) {
          publish()
          if (restored && canSaveCamera()) persistence?.saveCamera(viewPoint)
        }
      })
      publish()
    },
    toggleFrozen() {
      if (!camera || disposed) return
      camera.controls = !camera.controls
      persistence?.saveFrozen(!camera.controls)
      publish()
    },
    zoom(factor: number) {
      if (!Number.isFinite(factor) || factor <= 0) throw new RangeError("Zoom factor must be positive")
      if (!camera || disposed) return
      const distance = Math.hypot(camera.x - camera.targetX, camera.y - camera.targetY, camera.z - camera.targetZ)
      if (distance === 0) return
      camera.dollyTo(Math.max(camera.near * 1.01, Math.min(camera.far * .9, distance * factor)))
    },
    fit() { if (camera && !disposed) fit() },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      camera = null
      publish()
      listeners.clear()
    },
  })
}
