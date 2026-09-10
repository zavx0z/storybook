import {expect, test} from "bun:test"
import {createDocument, acquireDocumentAuthorStyleSheetOwner} from "@zavx0z/dom"
import {flushDocumentLayoutObservers} from "@zavx0z/dom/geometry"
import {createDocumentRenderer} from "@renderer/html"
import {layoutTopDown} from "@nodes/layout/top-down"
import {createCubicLinkRoute, projectLinkArrowheads, projectLinkEndpoints, projectLinkRoute} from "@webxr/nodes/link"
import {createDependencyPresentation, dependencyGraphInput} from "./dependency-view.tsx"

const ownerId = "owner.tsx#Owner"
const leafId = "leaf.tsx#Leaf"
const ownerElement = JSON.stringify([ownerId, "element", "article"])
const leafElement = JSON.stringify([leafId, "element", "span"])
const value = {
  name: "Example", file: "owner.tsx", testName: "Состав",
  graph: {[ownerId]: {uses: [leafId], elements: ["article"]}, [leafId]: {uses: [], elements: ["span"]}},
}

test("целевой компонент остаётся сверху с прежними маршрутами, меняется только start marker", async () => {
  const before = JSON.stringify(value)
  const graph = dependencyGraphInput(value)
  const measurements = graph.input.nodes.map(node => ({id: node.id, width: 100, height: 40, anchors: []}))
  const scene = await graph.layout(measurements)
  const expected = layoutTopDown({
    attachment: "contour",
    nodes: measurements.map(node => ({...node, shape: "rectangle" as const})),
    edges: [
      {id: JSON.stringify([ownerId, leafId]), sourceNodeId: ownerId, targetNodeId: leafId},
      {id: ownerElement, sourceNodeId: ownerId, targetNodeId: ownerElement},
      {id: leafElement, sourceNodeId: leafId, targetNodeId: leafElement},
    ],
    layoutOptions: {nodeSpacing: 32, layerSpacing: 48, padding: 16},
  })
  expect(scene.nodes).toEqual(expected.nodes)
  expect(JSON.stringify(value)).toBe(before)
  const root = scene.nodes.find(node => node.id === ownerId)!
  expect(root.y).toBeLessThan(scene.nodes.find(node => node.id === leafId)!.y)
  for (const link of scene.links ?? []) {
    const route = expected.edges.find(edge => edge.id === link.id)!
    expect(projectLinkRoute(link.route).d).toBe(projectLinkRoute(createCubicLinkRoute(route.curves)).d)
    expect(link.startArrow).toBeTrue()
    expect(link.endArrow ?? false).toBeFalse()
    expect(projectLinkArrowheads(link.route, link.startArrow, link.endArrow).map(marker => marker.side)).toEqual(["start"])
    expect(projectLinkEndpoints(link.route).start.direction.y).toBeLessThan(0)
  }
})

test("CSS центрирует граф с подписью и оставляет большой граф доступным через scroll", async () => {
  const document = createDocument()
  const owner = document.createElement("div")
  owner.setAttribute("style", "width:100%;height:100%")
  document.append(owner)
  const renderer = createDocumentRenderer({document, root: owner, viewport: {width: 900, height: 650},
    textMeasurer: {measureTextAdvance: (text, size) => text.length * size * .5}})
  const styles = acquireDocumentAuthorStyleSheetOwner(document)
  styles.replace([{id: "theme", cssText: await Bun.file(Bun.resolveSync("@zavx0z/ui/themes/theme.css", import.meta.dir)).text()}])
  const presentation = createDependencyPresentation(document, [value])
  owner.append(presentation.element)
  const flush = async () => {
    for (let pass = 0; pass < 30; pass += 1) {
      await Promise.resolve()
      presentation.componentRoot.flush()
      renderer.flush()
      flushDocumentLayoutObservers(document)
    }
    return renderer.flush()
  }
  try {
    await flush()
    const outer = presentation.element.getLayoutRect()!
    const content = presentation.element.firstElementChild!.firstElementChild!.getLayoutRect()!
    const view = owner.querySelector("[data-graph-view]")!
    const graph = view.getLayoutRect()!
    expect(owner.querySelector('[data-layout-pending="true"]')).toBeNull()
    expect(graph.x + graph.width / 2).toBeCloseTo(outer.x + outer.width / 2)
    expect(content.y + content.height / 2).toBeCloseTo(outer.y + outer.height / 2)
    renderer.resize({width: 180, height: 80})
    const frame = await flush()
    const small = presentation.element.getLayoutRect()!
    const large = presentation.element.firstElementChild!.firstElementChild!.getLayoutRect()!
    expect(owner.querySelector("[data-graph-view]")).toBe(view)
    expect(large.x).toBeGreaterThanOrEqual(small.x)
    expect(large.y).toBeGreaterThanOrEqual(small.y)
    expect(frame.scrolls.get(presentation.element)?.maxScrollLeft).toBeGreaterThan(0)
    expect(frame.scrolls.get(presentation.element)?.maxScrollTop).toBeGreaterThan(0)
  } finally {
    presentation.dispose()
    styles.release()
    renderer.dispose()
  }
})
