import {DisplayElement} from "@zavx0z/immersive-dom/display"
import type {StorybookAppProps} from "./application-props"
import type {Document, HTMLElement} from "@zavx0z/immersive-dom"
import type {Presentation as Root} from "@zavx0z/immersive-browser/integration"
import {layoutHierarchy} from "@zavx0z/immersive-nodes-layout/hierarchy"
import {spatialContentBounds, spatialGraphBounds, SPATIAL_GRAPH_NODE_SIZE} from "@zavx0z/immersive-nodes/spatial"
import type {StorybookAppWebPageShell} from "../contract"
import type {StorybookShellUserState} from "../contract/types"
import type {createSubjectGraphState, SubjectGraphPresentation} from "./subject-graph-state"
import {writeViewPointSnapshot} from "./implementation"

type Shell = StorybookAppWebPageShell.Output
type Subject = Parameters<Shell["configureSubjects"]>[0][number]
type Bounds = Readonly<{x: number; y: number; z: number; width: number; height: number}>

/** Связывает полный граф с поверхностями предметов в едином Document и Space. */
export function createSubjectGraph(options: Readonly<{
  document: Document
  root: Root
  source: ReturnType<typeof createSubjectGraphState>
  baseDisplay: DisplayElement
  preserveCamera?: boolean
  getViewport(): Readonly<{width: number; height: number}> | null
  createView(id: string, title: string, mount: (content: StorybookAppProps | null) => void, display: DisplayElement, onRelease: () => void, userState?: StorybookShellUserState): Shell
}>) {
  const {document, root} = options
  const hosts = new Map<string, DisplayElement>()
  const views = new Map<string, Shell>()
  const contents = new Map<string, StorybookAppProps>()
  let subjects: readonly Subject[] = []
  let props: SubjectGraphPresentation | null = null
  let selectedId: string | null = null
  let onSelect = (_id: string): void => {}
  let onDemand: ((id: string) => void) | undefined
  const demanded = new Set<string>()
  let disposed = false
  let fitted = false
  let viewport = options.getViewport()

  const displayDimensions = () => {
    const size = viewport ?? options.getViewport() ?? {width: 960, height: 540}
    const width = Math.max(1, Math.round(size.width))
    const height = Math.max(1, Math.round(size.height))
    const physicalWidth = Math.min(20, 12.5 * width / height)
    return {
      contentViewport: {width, height},
      contentSurface: {width: physicalWidth, height: physicalWidth * height / width},
    }
  }
  const ensureActive = (): void => {
    if (disposed) throw new Error("Storybook subject graph is disposed")
  }
  const render = (): void => {
    if (props === null) return
    options.source.publish({...props, selectedId, contentById: new Map(contents)})
    root.invalidate()
  }
  const frame = (bounds: Bounds): void => {
    const size = viewport ?? options.getViewport() ?? {width: 1024, height: 640}
    const camera = root.viewPoint
    const aspect = size.width / Math.max(1, size.height)
    const distance = Math.max(camera.near * 1.01,
      Math.max(bounds.height, bounds.width / aspect) * 1.12 / (2 * Math.tan(camera.fov / 2)))
    writeViewPointSnapshot(document, camera, {
      position: {x: bounds.x, y: bounds.y - distance, z: bounds.z},
      target: {x: bounds.x, y: bounds.y, z: bounds.z},
      fov: camera.fov,
      near: camera.near,
      far: Math.max(camera.far, distance + Math.max(bounds.width, bounds.height) + 1000),
    })
    root.invalidate()
  }
  const fit = (): void => {
    ensureActive()
    if (props === null) return
    frame(spatialGraphBounds(props.bounds, props))
    fitted = true
  }
  const releaseView = (id: string): void => {
    views.get(id)?.dispose()
    views.delete(id)
    demanded.delete(id)
  }
  const configure = (items: readonly Subject[], callback: (id: string) => void, demand?: (id: string) => void): void => {
    ensureActive()
    const labels = new Map(items.map(item => [item.id, item.label]))
    const layout = layoutHierarchy({
      nodes: items.map(item => ({id: item.id, ...(item.parentId === undefined ? {} : {parentId: item.parentId}), width: SPATIAL_GRAPH_NODE_SIZE.width, height: SPATIAL_GRAPH_NODE_SIZE.height})),
      options: {siblingSpacing: 64, layerSpacing: 160},
    })
    const first = props === null
    for (const id of views.keys()) if (!labels.has(id)) releaseView(id)
    subjects = [...items]
    onSelect = callback
    onDemand = demand
    props = {
      ...displayDimensions(),
      contentById: new Map(contents),
      bounds: layout.bounds,
      nodes: layout.nodes.map(node => ({id: node.id, title: labels.get(node.id)!, rect: node})),
      links: layout.edges.map(edge => ({
        id: edge.id,
        title: "Содержит",
        route: {kind: "orthogonal", points: edge.sections.flatMap(section => [section.startPoint, ...section.bendPoints, section.endPoint])},
      })),
      onContentHost(id, host) {
        if (host === null) hosts.delete(id)
        else hosts.set(id, host)
      },
      onSelect(id) { onSelect(id) },
    }
    options.baseDisplay.hidden = true
    render()
    if (first) {
      if (options.preserveCamera) fitted = true
      else { root.viewPoint.controls = true; fit() }
    }
    // Публикация общего кадра регистрирует новые Display до первого createView.
    root.render()
  }
  const createView = ({id, title, userState}: Readonly<{id: string; title: string; userState?: StorybookShellUserState}>): Shell => {
    ensureActive()
    const retained = views.get(id)
    if (retained !== undefined) return retained
    const host = hosts.get(id)
    if (host === undefined || !subjects.some(subject => subject.id === id)) {
      throw new Error(`Storybook subject ${id} has no graph content host`)
    }
    const view = options.createView(id, title, content => {
      if (content === null) contents.delete(id)
      else contents.set(id, content)
      render()
    }, host, () => views.delete(id), userState)
    views.set(id, view)
    demanded.add(id)
    return view
  }
  const select = (id: string, focus = false): void => {
    ensureActive()
    const node = props?.nodes.find(item => item.id === id)
    if (node === undefined) throw new Error(`Storybook subject ${id} is absent from the graph`)
    selectedId = id
    render()
    if (focus) frame(spatialContentBounds(node.rect, props!))
  }
  // Browser проецирует CSS-точки каждой настоящей поверхности общей камерой.
  // Приближение наполняет ближайший Display, сохраняя положение камеры.
  const unsubscribeDemand = root.subscribePresented(() => {
    if (disposed || onDemand === undefined || props === null || views.size === 0) return
    const size = viewport ?? options.getViewport()
    if (size === null) return
    let nearest: Readonly<{id: string; distance: number}> | null = null
    for (const [id, display] of hosts) {
      const projection = root.getProjection(display)
      const start = projection.projectPoint({x: 0, y: 0})
      const end = projection.projectPoint({x: props.contentViewport.width, y: props.contentViewport.height})
      if (start === null || end === null || Math.abs(end.x - start.x) < 320) continue
      const x = (start.x + end.x) / 2
      const y = (start.y + end.y) / 2
      if (x < 0 || x > size.width || y < 0 || y > size.height) continue
      const distance = Math.hypot(x - size.width / 2, y - size.height / 2)
      if (nearest === null || distance < nearest.distance) nearest = {id, distance}
    }
    if (nearest !== null && !demanded.has(nearest.id)) {
      demanded.add(nearest.id)
      onDemand(nearest.id)
    }
  })
  return Object.freeze({
    get configured() { return props !== null },
    configure,
    createView,
    releaseView,
    select,
    fit,
    updateViewport(value: Readonly<{width: number; height: number}>) {
      if (viewport?.width === value.width && viewport?.height === value.height) return
      viewport = value
      if (props !== null) {
        props = {...props, ...displayDimensions()}
        render()
      }
      if (!fitted) fit()
    },
    dispose() {
      if (disposed) return
      for (const view of [...views.values()]) view.dispose()
      disposed = true
      views.clear()
      hosts.clear()
      contents.clear()
      unsubscribeDemand()
      options.source.publish(null)
    },
  })
}
