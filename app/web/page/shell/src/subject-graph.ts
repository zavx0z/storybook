import type {DisplayElement} from "@zavx0z/immersive"
import type {Document} from "@zavx0z/immersive"
import type {Presentation} from "@zavx0z/immersive/XReact/browser/integration"
import {component} from "@zavx0z/immersive/XReact"
import type {CompiledTemplate} from "@zavx0z/immersive/XReact/compiled"
import {createSpatialTreeController} from "@zavx0z/immersive/nodes/spatial/tree"
import type {StorybookAppWebPageShell} from "../contract"
import type {StorybookShellUserState} from "../contract/types"
import type {StorybookAppProps} from "./application-props"
import type {createSubjectGraphState} from "./subject-graph-state"
import {bindStorybookDisplayGlass} from "./display-glass"
import {StorybookSurface} from "./application.tsx"

type Shell = StorybookAppWebPageShell.Output
type Subject = Parameters<Shell["configureSubjects"]>[0][number]

/**
Адаптер предметных данных и содержимого Storybook. Раскладка, Display, объёмы,
видимость и перемещение ViewPoint полностью принадлежат Immersive Nodes.
*/
export function createSubjectGraph(options: Readonly<{
  document: Document
  root: Presentation
  source: ReturnType<typeof createSubjectGraphState>
  baseDisplay: DisplayElement
  preserveViewPoint?: boolean
  getViewport(): Readonly<{width: number; height: number}> | null
  createView(id: string, title: string, mount: (content: StorybookAppProps | null) => void, display: DisplayElement,
    onRelease: () => void, userState?: StorybookShellUserState): Shell
}>) {
  const spatial = createSpatialTreeController({
    root: options.root,
    state: options.source,
    getViewport: options.getViewport,
    preserveViewPoint: options.preserveViewPoint ?? false,
  })
  const views = new Map<string, Shell>()
  const glass = bindStorybookDisplayGlass({
    document: options.document,
    viewPoint: options.root.viewPoint,
    baseDisplay: options.baseDisplay,
    source: options.source,
    displayFor: id => views.get(id)?.display ?? null,
  })
  let disposed = false
  const releaseView = (id: string) => {
    views.get(id)?.dispose()
    views.delete(id)
    spatial.release(id)
    glass.update()
  }
  return {
    get configured() { return spatial.configured },
    configure(items: readonly Subject[], onSelect: (id: string, focus?: boolean) => void, onDemand?: (id: string) => void) {
      const ids = new Set(items.map(item => item.id))
      for (const id of [...views.keys()]) if (!ids.has(id)) releaseView(id)
      spatial.configure(items.map(({id, parentId, label}) => ({id, ...(parentId === undefined ? {} : {parentId}), label})), onSelect, onDemand)
      options.baseDisplay.hidden = true
      glass.update()
    },
    createView({id, title, userState}: Readonly<{id: string; title: string; userState?: StorybookShellUserState}>) {
      if (disposed) throw new Error("Storybook subject adapter is disposed")
      const previous = views.get(id)
      if (previous !== undefined) return previous
      const display = spatial.ensureDisplay(id)
      const view = options.createView(id, title, value => {
        spatial.setContent(id, value === null ? null : component(StorybookSurface as unknown as CompiledTemplate<StorybookAppProps>, value, id))
      }, display, () => {
        views.delete(id)
        spatial.release(id)
        glass.update()
      }, userState)
      views.set(id, view)
      glass.update()
      return view
    },
    releaseView,
    select: spatial.select,
    fit: spatial.fit,
    zoom(factor: number) {
      if (!spatial.configured) return false
      spatial.zoom(factor)
      return true
    },
    setBaseFit: glass.setBaseFit,
    updateViewport(viewport: Readonly<{width: number; height: number}>) {
      spatial.updateViewport(viewport)
      glass.updateViewport(viewport)
    },
    dispose() {
      if (disposed) return
      glass.dispose()
      for (const view of [...views.values()]) view.dispose()
      views.clear()
      spatial.dispose()
      disposed = true
    },
  }
}
