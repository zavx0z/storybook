import type {DisplayElement} from "@zavx0z/immersive-dom/display"
import type {StorybookAppProps} from "./application-props"
import type {SpatialGraphProps} from "@zavx0z/immersive-nodes/spatial"

export type SubjectGraphPresentation = SpatialGraphProps & Readonly<{
  contentViewport: Readonly<{width: number; height: number}>
  contentById: ReadonlyMap<string, StorybookAppProps>
  onContentHost(id: string, host: DisplayElement | null): void
}>

/** Передаёт состояние графа единственному авторскому App без дополнительного Root. */
export function createSubjectGraphState() {
  let snapshot: SubjectGraphPresentation | null = null
  const listeners = new Set<() => void>()
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish(value: SubjectGraphPresentation | null) {
      snapshot = value
      for (const listener of [...listeners]) listener()
    },
  })
}
