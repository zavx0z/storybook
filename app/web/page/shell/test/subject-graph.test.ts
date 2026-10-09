import {afterEach, expect, test} from "bun:test"
import {createDocument} from "@zavx0z/immersive-dom"
import {DisplayElement} from "@zavx0z/immersive-dom/display"
import {SpaceElement} from "@zavx0z/immersive-dom/space"
import {ViewPointElement} from "@zavx0z/immersive-dom/viewpoint"
import type {Presentation, RootSpaceProjection} from "@zavx0z/immersive-browser/integration"
import type {SpatialTreeSnapshot} from "@zavx0z/immersive-nodes/spatial/tree"
import type {StorybookAppWebPageShell} from "../contract"
import type {StorybookShellUserState} from "../contract/types"
import type {StorybookAppProps} from "../src/application-props"
import {createSubjectGraph} from "../src/subject-graph"
import {createSubjectGraphState} from "../src/subject-graph-state"

type Graph = ReturnType<typeof createSubjectGraph>
const graphs: Graph[] = []
afterEach(() => { for (const graph of graphs.splice(0)) graph.dispose() })
const settle = async () => { for (let n = 0; n < 5; n++) await Promise.resolve() }

/** Реальны generic controller/store; seam заменяет только host refs и Browser presentation. */
function fixture() {
  const document = createDocument()
  const space = new SpaceElement(document)
  const viewPoint = new ViewPointElement(document)
  const baseDisplay = new DisplayElement(document)
  viewPoint.z = 1200
  viewPoint.y = 0
  viewPoint.targetX = viewPoint.targetY = viewPoint.targetZ = 0
  document.append(space)
  space.append(viewPoint, baseDisplay)
  const source = createSubjectGraphState()
  const hosts = new Map<string, DisplayElement>()
  const listeners = new Set<(frame: number) => void>()
  const opened: {id: string; title: string; display: DisplayElement; userState?: StorybookShellUserState}[] = []
  const released: string[] = []
  const counts = {published: 0, rendered: 0, projected: 0, frustum: 0}
  let frame = 0
  const snapshot = () => source.getSnapshot()!
  source.subscribe(() => {
    counts.published++
    const state = source.getSnapshot()
    if (state === null) {
      for (const host of hosts.values()) host.remove()
      hosts.clear()
      return
    }
    const ids = new Set(state.nodes.map(node => node.id))
    for (const [id, host] of hosts) if (!ids.has(id)) {
      state.onHost(id, null)
      host.remove()
      hosts.delete(id)
    }
    for (const node of state.nodes) if (!hosts.has(node.id)) {
      const host = new DisplayElement(document)
      host.id = `fake-spatial-display-${encodeURIComponent(node.id)}`
      host.setAttribute("data-spatial-node-id", node.id)
      space.append(host)
      hosts.set(node.id, host)
      state.onHost(node.id, host)
    }
  })
  const presented = () => { for (const listener of listeners) listener(++frame) }
  const projection: RootSpaceProjection = {
    kind: "space",
    owner: space,
    projectPoint(point) {
      counts.projected++
      return {x: 540 + point.x, y: 320 - point.y}
    },
    rayForPoint() {
      return {origin: {x: viewPoint.x, y: viewPoint.y, z: viewPoint.z}, direction: {x: 0, y: 0, z: -1}}
    },
    frustumPlanes() { counts.frustum++; return [] },
    fly(distance) { viewPoint.z -= distance; viewPoint.targetZ -= distance },
    orbit() {},
    pan() {},
    zoom() {},
  }
  const root = {
    document, space, viewPoint,
    canvas: {getBoundingClientRect: () => ({left: 40, top: 20, width: 1000, height: 600})},
    invalidate() {},
    render() { counts.rendered++; presented() },
    subscribePresented(listener: (frame: number) => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getProjection: () => projection,
  } as unknown as Presentation
  const graph = createSubjectGraph({
    document, root, source, baseDisplay, preserveViewPoint: true,
    getViewport: () => ({width: 1000, height: 600}),
    createView(id, title, mount, display, release, userState) {
      opened.push({id, title, display, ...(userState === undefined ? {} : {userState})})
      mount({title, displayId: display.id} as StorybookAppProps)
      let disposed = false
      return {document, root, space, viewPoint, display, dispose() {
        if (disposed) return
        disposed = true
        released.push(id)
        mount(null)
        release()
      }} as unknown as StorybookAppWebPageShell.Output
    },
  })
  graphs.push(graph)
  return {graph, root, document, space, viewPoint, baseDisplay, counts, snapshot, opened, released, presented,
    listenerCount: () => listeners.size}
}

const pose = (viewPoint: ViewPointElement) => [viewPoint.x, viewPoint.y, viewPoint.z,
  viewPoint.targetX, viewPoint.targetY, viewPoint.targetZ, viewPoint.fov, viewPoint.controls]
const items = [
  {id: "/", label: "Project"},
  {id: "/repo", parentId: "/", label: "Repo"},
  {id: "/repo/child", parentId: "/repo", surfaceId: "/repo", label: "Package"},
]

function node(state: SpatialTreeSnapshot, id: string) {
  return state.nodes.find(node => node.id === id)!
}

test("адаптер передаёт hierarchy/labels, каждая сущность получает собственный Display в том же Root", async () => {
  const f = fixture()
  const before = pose(f.viewPoint)
  f.graph.configure(items, () => {})
  const project = f.graph.createView({id: "/", title: "Project"})
  const repo = f.graph.createView({id: "/repo", title: "Repo"})
  const child = f.graph.createView({id: "/repo/child", title: "Package"})
  await settle()
  expect(new Set([project.display, repo.display, child.display]).size).toBe(3)
  for (const view of [project, repo, child]) {
    expect(view.document).toBe(f.document)
    expect(view.root).toBe(f.root)
    expect(view.space).toBe(f.space)
    expect(view.viewPoint).toBe(f.viewPoint)
    expect(view.display.closest("space")).toBe(f.space)
  }
  expect(node(f.snapshot(), "/repo/child").parentId).toBe("/repo")
  expect(node(f.snapshot(), "/repo/child").label).toBe("Package")
  expect(node(f.snapshot(), "/repo/child")).not.toHaveProperty("surfaceId")
  expect(f.baseDisplay.hidden).toBe(true)
  expect(pose(f.viewPoint)).toEqual(before)
})

test("повторный запрос view сохраняет контент и передаёт userState только при первом создании", async () => {
  const f = fixture()
  f.graph.configure(items, () => {})
  const userState = {} as StorybookShellUserState
  const first = f.graph.createView({id: "/repo/child", title: "Package", userState})
  const content = f.snapshot().contentById.get("/repo/child")
  expect(content).toBeDefined()
  expect(f.graph.createView({id: "/repo/child", title: "Other title"})).toBe(first)
  expect(f.opened).toHaveLength(1)
  expect(f.opened[0]!.userState).toBe(userState)
  expect(f.snapshot().contentById.get("/repo/child")).toBe(content)
  await settle()
})

test("запрос выбора из SpatialTree передаёт id/focus приложению и сохраняет самостоятельное содержимое", async () => {
  const f = fixture()
  const requests: {id: string; focus?: boolean}[] = []
  f.graph.configure(items, (id, focus) => requests.push({id, ...(focus === undefined ? {} : {focus})}))
  f.graph.createView({id: "/repo", title: "Repo"})
  f.graph.createView({id: "/repo/child", title: "Package"})
  const repoContent = f.snapshot().contentById.get("/repo")
  const childContent = f.snapshot().contentById.get("/repo/child")
  const before = pose(f.viewPoint)
  f.snapshot().onActivate("/repo/child", false)
  expect(requests).toEqual([{id: "/repo/child", focus: false}])
  f.graph.select("/repo/child", false)
  expect(f.snapshot().selectedId).toBe("/repo/child")
  expect(f.snapshot().contentById.get("/repo")).toBe(repoContent)
  expect(f.snapshot().contentById.get("/repo/child")).toBe(childContent)
  expect(repoContent).not.toBe(childContent)
  expect(pose(f.viewPoint)).toEqual(before)
  await settle()
})

test("обновление hierarchy сохраняет оставшийся content и освобождает view удалённой сущности", async () => {
  const f = fixture()
  f.graph.configure(items, () => {})
  const repo = f.graph.createView({id: "/repo", title: "Repo"})
  f.graph.createView({id: "/repo/child", title: "Package"})
  const content = f.snapshot().contentById.get("/repo")
  f.graph.configure(items.slice(0, 2).map(item => item.id === "/repo" ? {...item, label: "Renamed"} : item), () => {})
  await settle()
  expect(f.released).toEqual(["/repo/child"])
  expect(f.snapshot().contentById.has("/repo/child")).toBe(false)
  expect(f.snapshot().contentById.get("/repo")).toBe(content)
  expect(node(f.snapshot(), "/repo").label).toBe("Renamed")
  expect(f.graph.createView({id: "/repo", title: "Repo"})).toBe(repo)
})

test("release view очищает только его content и разрешает повторное создание", async () => {
  const f = fixture()
  f.graph.configure(items, () => {})
  const repo = f.graph.createView({id: "/repo", title: "Repo"})
  const child = f.graph.createView({id: "/repo/child", title: "Package"})
  const repoContent = f.snapshot().contentById.get("/repo")
  f.graph.releaseView("/repo/child")
  expect(f.released).toEqual(["/repo/child"])
  expect(f.snapshot().contentById.has("/repo/child")).toBe(false)
  expect(f.snapshot().contentById.get("/repo")).toBe(repoContent)
  expect(f.graph.createView({id: "/repo", title: "Repo"})).toBe(repo)
  const replacement = f.graph.createView({id: "/repo/child", title: "Package"})
  expect(replacement).not.toBe(child)
  expect(f.snapshot().contentById.has("/repo/child")).toBe(true)
  await settle()
})

test("demand видимого холодного предмета передаётся приложению через generic controller", async () => {
  const f = fixture()
  const demands: string[] = []
  f.graph.configure([{id: "only", label: "Only"}], () => {}, id => demands.push(id))
  await settle()
  await new Promise(resolve => setTimeout(resolve, 210))
  expect(demands).toEqual(["only"])
  f.graph.createView({id: "only", title: "Only"})
  f.presented()
  await settle()
  expect(f.snapshot().contentById.has("only")).toBe(true)
})

test("dispose освобождает view, store и presented subscription того же Root", async () => {
  const f = fixture()
  f.graph.configure(items, () => {})
  f.graph.createView({id: "/repo", title: "Repo"})
  f.graph.createView({id: "/repo/child", title: "Package"})
  f.graph.dispose()
  expect(f.released.sort()).toEqual(["/repo", "/repo/child"])
  expect(f.listenerCount()).toBe(0)
  expect(() => f.graph.createView({id: "/repo", title: "Repo"})).toThrow("disposed")
  f.presented()
  await settle()
  expect(f.document.querySelectorAll("display")).toHaveLength(1)
})
