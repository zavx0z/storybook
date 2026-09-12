import {expect, test} from "bun:test"
import {createDocument, acquireDocumentAuthorStyleSheetOwner, Event, WheelEvent, HTMLSelectElement} from "@zavx0z/dom"
import {flushDocumentLayoutObservers} from "@zavx0z/dom/geometry"
import {createDocumentRenderer} from "@renderer/html"
import {layoutTopDown} from "@nodes/layout/top-down"
import {createCubicLinkRoute, projectLinkArrowheads, projectLinkEndpoints, projectLinkRoute} from "@webxr/nodes/routing/link-path"
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
    graph: {
      attachment: "contour",
      nodes: measurements.map(node => ({...node, shape: "rectangle" as const})),
      edges: [
        {id: JSON.stringify([ownerId, leafId]), sourceNodeId: ownerId, targetNodeId: leafId},
        {id: ownerElement, sourceNodeId: ownerId, targetNodeId: ownerElement},
        {id: leafElement, sourceNodeId: leafId, targetNodeId: leafElement},
      ],
      layoutOptions: {nodeSpacing: 32, layerSpacing: 48, padding: 16},
    },
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

test("[DEPENDENCIES-FIT] большой граф вписывается в Display, ручная навигация сохраняется при resize, новый case вписывается заново", async () => {
  const document = createDocument()
  const owner = document.createElement("div")
  owner.setAttribute("style", "width:100%;height:100%")
  document.append(owner)
  const renderer = createDocumentRenderer({document, root: owner, viewport: {width: 900, height: 650},
    textMeasurer: {measureTextAdvance: (text, size) => text.length * size * .5}})
  const styles = acquireDocumentAuthorStyleSheetOwner(document)
  styles.replace([{id: "theme", cssText: await Bun.file(Bun.resolveSync("@zavx0z/ui/themes/theme.css", import.meta.dir)).text()}])
  const leaves = Array.from({length: 48}, (_, index) => `leaf-${index}.tsx#Leaf${index}`)
  const large = {...value, name: "Большой граф", graph: {
    [ownerId]: {uses: leaves, elements: ["article"]},
    ...Object.fromEntries(leaves.map(id => [id, {uses: [], elements: ["span"]}])),
  }}
  const presentation = createDependencyPresentation(document, [large, value])
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
    const view = owner.querySelector("[data-graph-view]")!
    const viewport = view.querySelector("[data-graph-viewport]")!
    const firstNode = view.querySelector("[data-node-id]")!
    const expectFit = () => {
      const box = owner.querySelector("[data-graph-viewport]")!.getBoundingClientRect()
      const nodes = owner.querySelectorAll("[data-node-id]")
      expect(nodes.length).toBeGreaterThan(0)
      for (const node of nodes) {
        const rect = node.getBoundingClientRect()
        expect(rect.left).toBeGreaterThanOrEqual(box.left - .01)
        expect(rect.top).toBeGreaterThanOrEqual(box.top - .01)
        expect(rect.right).toBeLessThanOrEqual(box.right + .01)
        expect(rect.bottom).toBeLessThanOrEqual(box.bottom + .01)
      }
    }
    expect(owner.querySelector('[data-layout-pending="true"]')).toBeNull()
    expect(viewport.getLayoutRect()!.width).toBe(900)
    expect(viewport.getLayoutRect()!.height).toBeLessThan(650)
    expectFit()
    expect(firstNode.getBoundingClientRect().width / firstNode.getLayoutRect()!.width).toBeLessThan(.16)
    renderer.resize({width: 360, height: 280})
    await flush()
    expectFit()
    expect(owner.querySelector("[data-graph-view]")).toBe(view)
    expect(view.querySelector("[data-node-id]")).toBe(firstNode)
    viewport.dispatchEvent(new WheelEvent("wheel", {deltaX: 80, deltaY: 50, bubbles: true, cancelable: true}))
    await flush()
    const surface = view.querySelector("[data-graph-scene]")!
    const manual = surface.getAttribute("style")
    renderer.resize({width: 480, height: 340})
    const frame = await flush()
    expect(surface.getAttribute("style")).toBe(manual)
    expect(frame.scrolls.get(presentation.element)?.maxScrollLeft ?? 0).toBe(0)
    expect(frame.scrolls.get(presentation.element)?.maxScrollTop ?? 0).toBe(0)
    const select = owner.querySelector("select")!
    if (!(select instanceof HTMLSelectElement)) throw new Error("Нет выбора case")
    select.value = "1"
    select.dispatchEvent(new Event("change", {bubbles: true}))
    await flush()
    expect(owner.querySelector("[data-graph-view]")).not.toBe(view)
    expect(owner.querySelectorAll("[data-node-id]")).toHaveLength(4)
    expectFit()
    expect(owner.querySelectorAll("canvas")).toHaveLength(0)
  } finally {
    presentation.dispose()
    styles.release()
    renderer.dispose()
  }
})
