import {describe, expect, test} from "bun:test"
import {createDocument, Element, type Document} from "@zavx0z/dom"
import {createDocumentRenderer, type RenderBox} from "@renderer/html"
import {
  STORYBOOK_PRESENTATION_PROTOCOL,
  type StorybookRuntimePresentationInput,
} from "./runtime-protocol.ts"
import {createStorybookAggregatePresentation} from "./aggregate-presentation.tsx"
import {projectStorybookSource} from "./source-projection.ts"

describe("external Storybook aggregate presentation", () => {
  test("publishes only into attached same-Document hosts and releases roots and source together", () => {
    const document = createDocument()
    const child = ownerPresentation(document, "only")
    const presentation = createStorybookAggregatePresentation(document, "Overview", [{
      id: "only",
      label: "Only child",
      route: "components/only",
    }])
    expect(() => presentation.present("only", child)).toThrow("host is detached")
    document.appendChild(presentation.element)
    expect(() => presentation.present("only", ownerPresentation(createDocument(), "foreign")))
      .toThrow("different Document")
    const detach = presentation.present("only", child)
    expect(presentation.source.typescript).toContain('export const id = "only"')
    expect(() => presentation.present("only", child)).toThrow("already published")
    detach()
    detach()
    expect(child.node.parentNode).toBeNull()
    expect(presentation.source.typescript).toBe("")
    presentation.dispose()
    expect(presentation.element.parentNode).toBeNull()
    expect(() => presentation.present("only", child)).toThrow("is disposed")
  })

  test("uses parent-owned wrapping and compact cross-start rows for bounded real child roots", () => {
    const document = createDocument()
    const children = ["alpha", "beta", "gamma"].map(id => ownerPresentation(document, id))
    const presentation = createStorybookAggregatePresentation(
      document,
      "Adaptive overview",
      children.map((_child, index) => Object.freeze({
        id: `child-${index}`,
        label: `Child ${index}`,
        route: `components/child-${index}`,
      })),
    )
    document.appendChild(presentation.element)
    children.forEach((child, index) => presentation.present(`child-${index}`, child))

    const grid = requiredElement(
      presentation.element.querySelector("[data-storybook-aggregate-grid]"),
      "aggregate grid",
    )
    const tiles = [...grid.children]
    expect(tiles).toHaveLength(3)
    expect(children.map(({node}) => node.ownerDocument)).toEqual([document, document, document])
    expect(children.map(({node}) => node.parentNode instanceof Element
      ? node.parentNode.getAttribute("data-storybook-aggregate-stage")
      : null))
      .toEqual(["child-0", "child-1", "child-2"])

    const ownerCss = projectStorybookSource(
      presentation.source,
      presentation.componentRoot,
      document,
      [],
    ).css.componentStyleSheets.find(sheet =>
      sheet.moduleId === "@zavx0z/storybook/runtime/aggregate-presentation.tsx" &&
      sheet.componentName === "StorybookAggregateOverviewView"
    )?.cssText
    expect(ownerCss).toContain("flex-direction:row;flex-wrap:wrap;align-content:flex-start")
    expect(ownerCss).toContain("overflow-y:auto")
    expect(ownerCss).not.toContain("position:absolute")
    expect(ownerCss).not.toContain("left:")
    expect(ownerCss).not.toContain("top:")
    expect(tiles.map(tile => tile.getAttribute("style")))
      .toEqual(Array(3).fill(expect.stringContaining("flex: 0 0 280px")))

    const renderer = createDocumentRenderer({
      document,
      root: presentation.element,
      viewport: {width: 600, height: 420},
    })
    const frame = renderer.flush()
    const gridBox = requiredBox(frame.boxByNode.get(grid), "aggregate grid")
    const [first, second, third] = requiredTriple(
      tiles.map((tile, index) => requiredBox(frame.boxByNode.get(tile), `tile ${index}`)),
      "aggregate tile boxes",
    )

    expect(first.y).toBe(gridBox.contentY)
    expect(first).toMatchObject({width: 280, height: 180})
    expect(second).toMatchObject({y: first.y, width: 280, height: 180})
    expect(second.x).toBe(first.x + first.width + 8)
    expect(third).toMatchObject({x: first.x, width: 280, height: 180})
    expect(third.y).toBe(first.y + first.height + 8)
    expect(gridBox.contentY + gridBox.contentHeight - (third.y + third.height))
      .toBeGreaterThan(0)

    renderer.dispose()
    presentation.dispose()
  })

  test("lets one real child fill the available aggregate grid", () => {
    const document = createDocument()
    const child = ownerPresentation(document, "only")
    const presentation = createStorybookAggregatePresentation(
      document,
      "Single overview",
      [Object.freeze({
        id: "only",
        label: "Only child",
        route: "components/only",
      })],
    )
    document.appendChild(presentation.element)
    presentation.present("only", child)

    const grid = requiredElement(
      presentation.element.querySelector("[data-storybook-aggregate-grid]"),
      "aggregate grid",
    )
    const tile = requiredElement(grid.firstElementChild, "single aggregate tile")
    const renderer = createDocumentRenderer({
      document,
      root: presentation.element,
      viewport: {width: 600, height: 420},
    })
    const frame = renderer.flush()
    const gridBox = requiredBox(frame.boxByNode.get(grid), "aggregate grid")
    const tileBox = requiredBox(frame.boxByNode.get(tile), "single aggregate tile")

    expect(tileBox).toMatchObject({
      x: gridBox.contentX,
      y: gridBox.contentY,
      width: gridBox.contentWidth,
      height: gridBox.contentHeight,
    })
    expect(child.node.parentNode instanceof Element
      ? child.node.parentNode.getAttribute("data-storybook-aggregate-stage")
      : null).toBe("only")

    renderer.dispose()
    presentation.dispose()
  })

  test("fits differently sized production roots independently inside their tiles", () => {
    const document = createDocument()
    const children = [
      {id: "wide", width: 900, height: 600},
      {id: "tall", width: 520, height: 920},
      {id: "transformed", width: 720, height: 480},
    ].map(size => {
      const presentation = ownerPresentation(document, size.id)
      const node = presentation.node as import("@zavx0z/dom").HTMLElement
      node.setAttribute("style", `width: ${size.width}px; height: ${size.height}px`)
      if (size.id === "transformed") {
        node.setAttribute("style", `${node.getAttribute("style")}; margin: 12px; transform: translate(40px, -20px) scale(1.5)`)
      }
      return {...size, presentation, node, style: node.getAttribute("style")}
    })
    const presentation = createStorybookAggregatePresentation(document, "Sizes", children.map(({id}) => ({
      id,
      label: id,
      route: `components/${id}`,
    })))
    document.appendChild(presentation.element)
    children.forEach(child => presentation.present(child.id, child.presentation))
    const renderer = createDocumentRenderer({document, root: presentation.element, viewport: {width: 600, height: 420}})
    expect(presentation.fitToFrame(renderer.flush())).toBeTrue()
    const frame = renderer.flush()
    expect(presentation.fitToFrame(frame)).toBeFalse()
    const scales: number[] = []
    for (const child of children) {
      const host = requiredElement(presentation.element.querySelector(
        `[data-storybook-aggregate-item="${child.id}"]`,
      ), child.id)
      const viewport = requiredBox(frame.boxByNode.get(host), "tile viewport")
      const owner = requiredBox(frame.boxByNode.get(child.node), "production owner")
      expect(owner).toMatchObject({width: child.width, height: child.height})
      expect(child.node.getAttribute("style")).toBe(child.style)
      expect(child.node.ownerDocument).toBe(document)
      expect(owner.transform.scaleX).toBeCloseTo(owner.transform.scaleY)
      expect(owner.transform.scaleX).toBeLessThan(1)
      expectContained(owner, viewport)
      scales.push(owner.transform.scaleX)
    }
    expect(scales[0]).not.toBe(scales[1])
    expect(frame.boxByNode.get(presentation.element)?.transform.scaleX).toBe(1)
    renderer.dispose()
    presentation.dispose()
  })

  test("refits after viewport and owner size changes without remounting or accumulating scale", () => {
    const document = createDocument()
    const child = ownerPresentation(document, "resizable")
    const owner = child.node as import("@zavx0z/dom").HTMLElement
    owner.setAttribute("style", "width: 900px; height: 600px")
    const presentation = createStorybookAggregatePresentation(document, "Resize", [{
      id: "resizable", label: "Resizable", route: "components/resizable",
    }])
    document.appendChild(presentation.element)
    presentation.present("resizable", child)
    const host = requiredElement(presentation.element.querySelector("[data-storybook-aggregate-item]"), "viewport")
    const renderer = createDocumentRenderer({document, root: presentation.element, viewport: {width: 600, height: 420}})
    const scales: number[] = []
    for (const [width, height] of [[600, 420], [320, 240], [600, 420]] as const) {
      renderer.resize({width, height})
      presentation.fitToFrame(renderer.flush())
      const frame = renderer.flush()
      const ownerBox = requiredBox(frame.boxByNode.get(owner), "owner")
      expectContained(ownerBox, requiredBox(frame.boxByNode.get(host), "viewport"))
      expect(presentation.fitToFrame(frame)).toBeFalse()
      expect(ownerBox).toMatchObject({width: 900, height: 600})
      scales.push(ownerBox.transform.scaleX)
    }
    expect(scales[1]).toBeLessThan(scales[0]!)
    expect(scales[2]).toBeCloseTo(scales[0]!)
    owner.setAttribute("style", "width: 1200px; height: 1200px")
    expect(presentation.fitToFrame(renderer.flush())).toBeTrue()
    const changed = renderer.flush()
    const changedOwner = requiredBox(changed.boxByNode.get(owner), "changed owner")
    expectContained(changedOwner, requiredBox(changed.boxByNode.get(host), "viewport"))
    expect(changedOwner).toMatchObject({width: 1200, height: 1200})
    expect(presentation.fitToFrame(changed)).toBeFalse()
    expect(presentation.element.contains(owner)).toBeTrue()
    presentation.dispose()
    expect(presentation.fitToFrame(changed)).toBeFalse()
    renderer.dispose()
  })
})

function expectContained(owner: RenderBox, viewport: RenderBox): void {
  const left = owner.x * owner.transform.scaleX + owner.transform.translateX
  const top = owner.y * owner.transform.scaleY + owner.transform.translateY
  const width = owner.width * owner.transform.scaleX
  const height = owner.height * owner.transform.scaleY
  expect(left).toBeGreaterThanOrEqual(viewport.contentX - 0.00001)
  expect(top).toBeGreaterThanOrEqual(viewport.contentY - 0.00001)
  expect(left + width).toBeLessThanOrEqual(viewport.contentX + viewport.contentWidth + 0.00001)
  expect(top + height).toBeLessThanOrEqual(viewport.contentY + viewport.contentHeight + 0.00001)
  expect(left + width / 2).toBeCloseTo(viewport.contentX + viewport.contentWidth / 2, 4)
  expect(top + height / 2).toBeCloseTo(viewport.contentY + viewport.contentHeight / 2, 4)
}

function ownerPresentation(
  document: Document,
  id: string,
): StorybookRuntimePresentationInput {
  const node = document.createElement("div")
  node.setAttribute("data-owner-root", id)
  node.textContent = id
  return Object.freeze({
    protocol: STORYBOOK_PRESENTATION_PROTOCOL,
    node,
    componentRoot: Object.freeze({
      readStyleSheets: () => Object.freeze({
        revision: 0,
        styleSheets: Object.freeze([]),
      }),
    }),
    source: Object.freeze({
      html: `<div data-owner-root="${id}">${id}</div>`,
      typescript: `export const id = ${JSON.stringify(id)}`,
    }),
  })
}

function requiredElement(value: Element | null, label: string): Element {
  if (value === null) throw new Error(`Missing ${label}`)
  return value
}

function requiredBox(value: RenderBox | undefined, label: string): RenderBox {
  if (value === undefined) throw new Error(`Missing ${label} box`)
  return value
}

function requiredTriple<Value>(
  values: readonly Value[],
  label: string,
): readonly [Value, Value, Value] {
  const first = values[0]
  const second = values[1]
  const third = values[2]
  if (values.length !== 3 || first === undefined || second === undefined || third === undefined) {
    throw new Error(`Expected three ${label}`)
  }
  return [first, second, third]
}
