import {describe, expect, test} from "bun:test"
import {createDocument, Element, type Document} from "@zavx0z/dom"
import {createDocumentRenderer, type RenderBox} from "@zavx0z/renderer"
import {
  STORYBOOK_PRESENTATION_PROTOCOL,
  type StorybookRuntimePresentationInput,
} from "../runtime-protocol.ts"
import {createStorybookAggregatePresentation} from "./aggregate-presentation.tsx"
import {projectStorybookSource} from "./source-projection.ts"

describe("external Storybook aggregate presentation", () => {
  test("uses parent-owned wrapping and compact cross-start rows for bounded real child roots", () => {
    const document = createDocument()
    const children = ["alpha", "beta", "gamma"].map(id => ownerPresentation(document, id))
    const presentation = createStorybookAggregatePresentation(
      document,
      "Adaptive overview",
      children.map((child, index) => Object.freeze({
        id: `child-${index}`,
        label: `Child ${index}`,
        route: `components/child-${index}`,
        presentation: child,
      })),
    )
    document.appendChild(presentation.element)

    const grid = requiredElement(
      presentation.element.querySelector("[data-storybook-aggregate-grid]"),
      "aggregate grid",
    )
    const tiles = [...grid.children]
    expect(tiles).toHaveLength(3)
    expect(children.map(({node}) => node.ownerDocument)).toEqual([document, document, document])
    expect(children.map(({node}) => node.parentNode instanceof Element
      ? node.parentNode.getAttribute("data-storybook-aggregate-item")
      : null))
      .toEqual(["child-0", "child-1", "child-2"])

    const ownerCss = projectStorybookSource(
      presentation.source,
      presentation.componentRoot,
      document,
      [],
    ).css.componentStyleSheets.find(sheet =>
      sheet.moduleId === "@zavx0z/storybook/src/external/browser/aggregate-presentation.tsx" &&
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
        presentation: child,
      })],
    )
    document.appendChild(presentation.element)

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
      ? child.node.parentNode.getAttribute("data-storybook-aggregate-item")
      : null).toBe("only")

    renderer.dispose()
    presentation.dispose()
  })
})

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
