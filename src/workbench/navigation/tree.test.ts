import {beforeAll, describe, expect, test} from "bun:test"
import {
  createDocument,
  CustomEvent,
  Element,
  type HTMLButtonElement,
  type HTMLDivElement,
  type HTMLElement,
  KeyboardEvent,
  MouseEvent,
  Node,
} from "@zavx0z/dom"
import type {
  Workbench,
  WorkbenchNavigationItem,
} from "../contract.ts"
import {chevronDownIcon, chevronRightIcon} from "@ui/components/icons"
import {WORKBENCH_EVENTS} from "../contract.ts"
import type * as ControllerModule from "../controller.ts"
import {loadCompiledWorkbench} from "../testing/compile-workbench.ts"
import {projectWorkbenchNavigation} from "./model.ts"
import {
  navigationRootBlockRows,
  windowedBlocks,
} from "./windowing.ts"

let api: typeof ControllerModule

beforeAll(async () => {
  api = await loadCompiledWorkbench()
}, 30_000)

const groupedItems = Object.freeze([
  {
    id: "interfaces",
    label: "Интерфейсы",
    route: "dom/interfaces",
    title: "DOM API",
    searchText: "EventTarget Node Element",
    group: {id: "dom", label: "DOM"},
  },
  {
    id: "primitives",
    label: "Примитивы",
    route: "elements/primitives",
    searchText: "HTMLDivElement HTMLButtonElement",
    group: {id: "elements", label: "Элементы"},
  },
  {
    id: "styles",
    label: "Стили",
    route: "elements/style",
    group: {id: "elements", label: "Элементы"},
  },
] satisfies readonly WorkbenchNavigationItem[])

describe("compiled Storybook catalog navigation tree", () => {
  test("expanded disclosure blocks occupy their header and every visible category row", () => {
    const projection = projectWorkbenchNavigation(groupedItems, "", new Set())
    const blocks = windowedBlocks(projection, 0, null, new Set())
    const dom = blocks.find(block => block.kind === "group" && block.projection.group.id === "dom")
    const elements = blocks.find(block =>
      block.kind === "group" && block.projection.group.id === "elements")

    expect(dom).toBeDefined()
    expect(elements).toBeDefined()
    expect(navigationRootBlockRows(dom!, false)).toBe(2)
    expect(navigationRootBlockRows(elements!, false)).toBe(3)
    expect(navigationRootBlockRows(elements!, true)).toBe(1)
  })

  test("creates explicit group rows, child groups and active leaves", () => {
    const workbench = createWorkbench(groupedItems, "primitives")
    expect(workbench.elements.catalogItems.getAttribute("role")).toBe("tree")
    expect(groupRows(workbench).map((row) => row.getAttribute("aria-label"))).toEqual([
      "DOM",
      "Элементы",
    ])
    expect(groupRows(workbench).map((row) => row.getAttribute("aria-expanded"))).toEqual([
      "true",
      "true",
    ])
    expect(groupRows(workbench).map((row) => focusControl(row).textContent)).toEqual([
      "DOM",
      "Элементы",
    ])
    expect(groupRows(workbench).map((row) =>
      focusControl(row).querySelector("img")?.getAttribute("src"))).toEqual([
      chevronDownIcon,
      chevronDownIcon,
    ])
    expect(groupContainers(workbench).every((group) => group.getAttribute("role") === "group"))
      .toBeTrue()
    expect(groupContainers(workbench).every((group) =>
      (group.parentNode as Element | null)?.getAttribute("role") === "treeitem")).toBeTrue()
    expect(leafRows(workbench).map((row) => row.textContent)).toEqual([
      "Интерфейсы",
      "Примитивы",
      "Стили",
    ])
    expect(findLeaf(workbench, "interfaces")?.getAttribute("aria-level")).toBe("2")
    expect(findLeaf(workbench, "primitives")?.getAttribute("aria-current")).toBe("page")
    expect(findLeaf(workbench, "styles")?.getAttribute("aria-current")).toBeNull()
  })

  test("preserves keyed group and leaf identity across reorder and metadata updates", () => {
    const workbench = createWorkbench(groupedItems)
    const domGroup = findGroup(workbench, "dom")!
    const elementsGroup = findGroup(workbench, "elements")!
    const interfaces = findLeaf(workbench, "interfaces")!
    const styles = findLeaf(workbench, "styles")!

    workbench.update("catalog.items", [
      {...groupedItems[2]!, label: "CSS"},
      {...groupedItems[1]!, label: "HTML элементы"},
      {...groupedItems[0]!, label: "DOM интерфейсы"},
    ])

    expect(groupRows(workbench)).toEqual([elementsGroup, domGroup])
    expect(findLeaf(workbench, "interfaces")).toBe(interfaces)
    expect(findLeaf(workbench, "styles")).toBe(styles)
    expect(interfaces.textContent).toBe("DOM интерфейсы")
    expect(styles.textContent).toBe("CSS")

    clickGroup(elementsGroup)
    workbench.update("catalog.items", [groupedItems[0]!, groupedItems[2]!, groupedItems[1]!])
    expect(findGroup(workbench, "elements")).toBe(elementsGroup)
    expect(elementsGroup.getAttribute("aria-expanded")).toBe("false")

    workbench.update("catalog.items", [groupedItems[0]!])
    workbench.update("catalog.items", groupedItems)
    expect(findGroup(workbench, "elements")?.getAttribute("aria-expanded")).toBe("true")
  })

  test("toggles only the selected group by pointer and never navigates from its row", () => {
    const workbench = createWorkbench(groupedItems)
    const events: Array<Readonly<{type: string; detail: unknown}>> = []
    for (const type of [
      WORKBENCH_EVENTS.navigate,
      WORKBENCH_EVENTS.groupToggle,
    ]) {
      workbench.element.addEventListener(type, (event) => {
        events.push({type, detail: (event as CustomEvent).detail})
      })
    }
    const dom = findGroup(workbench, "dom")!
    const elements = findGroup(workbench, "elements")!
    const domDisclosure = focusControl(dom).querySelector("img")!
    expect(domDisclosure.getAttribute("src")).toBe(chevronDownIcon)

    clickGroup(dom)
    expect(dom.getAttribute("aria-expanded")).toBe("false")
    expect(focusControl(dom).querySelector("img")).toBe(domDisclosure)
    expect(domDisclosure.getAttribute("src")).toBe(chevronRightIcon)
    expect(elements.getAttribute("aria-expanded")).toBe("true")
    expect(events).toEqual([{
      type: "storybookgrouptoggle",
      detail: {kind: "catalog", id: "dom", collapsed: true},
    }])
    expect(workbench.controller.read("catalog.active")).toBeNull()

    clickGroup(dom)
    expect(dom.getAttribute("aria-expanded")).toBe("true")
    expect(focusControl(dom).querySelector("img")).toBe(domDisclosure)
    expect(domDisclosure.getAttribute("src")).toBe(chevronDownIcon)
    expect(events.at(-1)).toEqual({
      type: "storybookgrouptoggle",
      detail: {kind: "catalog", id: "dom", collapsed: false},
    })
  })

  test("implements visible-row keyboard navigation and tree disclosure rules", () => {
    const items = [
      groupedItems[0]!,
      {...groupedItems[1]!, disabled: true},
      groupedItems[2]!,
    ] as const
    const workbench = createWorkbench(items, "interfaces")
    const dom = findGroup(workbench, "dom")!
    const interfaces = findLeaf(workbench, "interfaces")!
    const elements = findGroup(workbench, "elements")!
    const styles = findLeaf(workbench, "styles")!
    focusControl(interfaces).focus()

    press(interfaces, "ArrowDown")
    expect(workbench.document.activeElement).toBe(focusControl(elements))
    press(elements, "ArrowRight")
    expect(workbench.document.activeElement).toBe(focusControl(styles))
    press(styles, "ArrowLeft")
    expect(workbench.document.activeElement).toBe(focusControl(elements))
    press(elements, "ArrowLeft")
    expect(elements.getAttribute("aria-expanded")).toBe("false")
    press(elements, "ArrowRight")
    expect(elements.getAttribute("aria-expanded")).toBe("true")
    press(elements, "End")
    expect(workbench.document.activeElement).toBe(focusControl(styles))
    press(styles, "Home")
    expect(workbench.document.activeElement).toBe(focusControl(dom))
    press(dom, "Enter")
    expect(dom.getAttribute("aria-expanded")).toBe("false")
    press(dom, " ")
    expect(dom.getAttribute("aria-expanded")).toBe("true")
  })

  test("repairs focus to the parent group when a focused child is collapsed", () => {
    const workbench = createWorkbench(groupedItems)
    const group = findGroup(workbench, "elements")!
    const child = findLeaf(workbench, "styles")!
    focusControl(child).focus()
    expect(workbench.document.activeElement).toBe(focusControl(child))

    clickGroup(group)
    expect(group.getAttribute("aria-expanded")).toBe("false")
    expect(workbench.document.activeElement).toBe(focusControl(group))
    expect(groupContainers(workbench)[1]?.querySelectorAll('[role="treeitem"]')).toHaveLength(0)
  })

  test("exposes disabled leaves while skipping and never activating them", () => {
    const workbench = createWorkbench([
      groupedItems[0]!,
      {...groupedItems[1]!, disabled: true},
      groupedItems[2]!,
    ], "interfaces")
    const disabled = findLeaf(workbench, "primitives")!
    const interfaces = findLeaf(workbench, "interfaces")!
    const elements = findGroup(workbench, "elements")!
    const styles = findLeaf(workbench, "styles")!
    const navigations: unknown[] = []
    workbench.element.addEventListener(WORKBENCH_EVENTS.navigate, (event) => {
      navigations.push((event as CustomEvent).detail)
    })

    const disabledButton = disabled.querySelector("button") as HTMLButtonElement
    expect(disabledButton.disabled).toBeTrue()
    expect(disabled.getAttribute("aria-disabled")).toBe("true")
    disabledButton.click()
    expect(navigations).toEqual([])
    focusControl(interfaces).focus()
    press(interfaces, "ArrowDown")
    expect(workbench.document.activeElement).toBe(focusControl(elements))
    press(elements, "ArrowRight")
    expect(workbench.document.activeElement).toBe(focusControl(styles))
  })

  test("searches group, label, title, route and domain aliases without changing collapse state", () => {
    const workbench = createWorkbench(groupedItems)
    const elements = findGroup(workbench, "elements")!
    clickGroup(elements)
    expect(elements.getAttribute("aria-expanded")).toBe("false")

    const cases = [
      ["DOM", ["interfaces"]],
      ["Интерфейсы", ["interfaces"]],
      ["DOM API", ["interfaces"]],
      ["dom/interfaces", ["interfaces"]],
      ["EventTarget", ["interfaces"]],
      ["Элементы", []],
    ] as const
    for (const [query, ids] of cases) {
      workbench.update("catalog.search", query)
      expect(leafRows(workbench).map((row) => row.getAttribute("data-id")), query).toEqual([...ids])
    }

    workbench.update("catalog.search", "")
    expect(findGroup(workbench, "elements")).toBe(elements)
    expect(elements.getAttribute("aria-expanded")).toBe("false")
    clickGroup(elements)
    workbench.update("catalog.search", "Элементы")
    expect(groupRows(workbench).map((row) => row.getAttribute("data-group-id"))).toEqual(["elements"])
    expect(leafRows(workbench)).toEqual([])
    workbench.update("catalog.search", "")
    expect(leafRows(workbench).map((row) => row.getAttribute("data-id"))).toEqual([
      "interfaces",
      "primitives",
      "styles",
    ])
  })

  test("fails closed for duplicate leaves and conflicting group descriptors", () => {
    const workbench = createWorkbench(groupedItems)
    const before = [...workbench.elements.catalogItems.childNodes]
    expect(() => workbench.update("catalog.items", [groupedItems[0]!, groupedItems[0]!]))
      .toThrow("Duplicate catalog item id: interfaces")
    expect(() => workbench.update("catalog.items", [
      groupedItems[1]!,
      {...groupedItems[2]!, group: {id: "elements", label: "Другие элементы"}},
    ])).toThrow("Conflicting catalog group label for id: elements")
    expect(workbench.elements.catalogItems.childNodes).toEqual(before)

    expect(() => workbench.update("catalog.items", [{
      id: "text",
      label: "Text",
      route: "text",
      group: {id: "text", label: "Text group"},
    }])).not.toThrow()
    expect(findGroup(workbench, "text")).toBeDefined()
    expect(findLeaf(workbench, "text")).toBeDefined()
  })

  test("publishes one atomic mutation batch for an interactive collapse", () => {
    const workbench = createWorkbench(groupedItems)
    const batches: unknown[] = []
    workbench.document.subscribeMutations((batch) => batches.push(batch))

    clickGroup(findGroup(workbench, "elements")!)
    expect(batches).toHaveLength(1)
    expect(findGroup(workbench, "elements")?.getAttribute("aria-expanded")).toBe("false")
  })

  test("scrolls the bounded window before sequential keyboard focus leaves its visible band", () => {
    const workbench = createWorkbench(Array.from({length: 100}, (_, index) => ({
      id: `row-${index}`,
      label: `Row ${index}`,
      route: `rows/${index}`,
    })))
    const first = findLeaf(workbench, "row-0")!
    focusControl(first).focus()
    for (let index = 0; index < 25; index++) {
      press(workbench.document.activeElement as HTMLElement, "ArrowDown")
    }

    expect((workbench.document.activeElement as HTMLElement).closest("[data-id]")?.getAttribute("data-id"))
      .toBe("row-25")
    expect(workbench.elements.catalogItems.scrollTop).toBeGreaterThan(0)
    expect(25 - workbench.elements.catalogItems.scrollTop / 24).toBeLessThan(20)
  })

  test("keeps a 1000-item catalog in a bounded keyed DOM projection", () => {
    const items: readonly WorkbenchNavigationItem[] = Array.from({length: 1000}, (_, index) => ({
      id: `item-${index}`,
      label: `Item ${index}`,
      route: `items/${index}`,
      searchText: index === 777 ? "needle alias" : "common",
      group: {id: "values", label: "Значения"},
    }))
    const workbench = createWorkbench(items)
    const tree = workbench.elements.catalogItems
    const first = findLeaf(workbench, "item-0")
    expect(tree.getAttribute("data-storybook-tree-total")).toBe("1000")
    expect(Number(tree.getAttribute("data-storybook-tree-materialized"))).toBeLessThan(1000)
    expect(leafRows(workbench)).toHaveLength(79)
    expect(tree.getAttribute("data-storybook-tree-created")).toBe("79")

    workbench.update("catalog.items", items.map((item, index) =>
      index === 0 ? {...item, label: "First item"} : item))
    expect(findLeaf(workbench, "item-0")).toBe(first)
    expect(first?.textContent).toBe("First item")
    expect(tree.getAttribute("data-storybook-tree-created")).toBe("79")

    workbench.update("catalog.search", "needle")
    expect(tree.scrollTop).toBe(0)
    expect(tree.getAttribute("data-storybook-tree-total")).toBe("1")
    expect(leafRows(workbench).map((row) => row.getAttribute("data-id"))).toEqual(["item-777"])
    workbench.update("catalog.search", "")
    expect(tree.scrollTop).toBe(0)
    const retainedFirst = findLeaf(workbench, "item-0")!
    focusControl(retainedFirst).focus()
    tree.scrollTop = 2400
    expect(Number(tree.getAttribute("data-storybook-tree-window-start"))).toBeGreaterThan(0)
    expect(workbench.document.activeElement).toBe(focusControl(retainedFirst))
    expect(retainedFirst.isConnected).toBeTrue()
    expect(leafRows(workbench).length).toBeLessThanOrEqual(81)
    expect(leafRows(workbench).filter((row) => focusControl(row).tabIndex === 0)).toEqual([retainedFirst])
    expect(Number(tree.getAttribute("data-storybook-tree-created"))).toBeLessThan(250)

    press(retainedFirst, "End")
    const last = findLeaf(workbench, "item-999")!
    expect(workbench.document.activeElement).toBe(focusControl(last))
    const window = Number(tree.getAttribute("data-storybook-tree-window-start"))
    const scrollRow = tree.scrollTop / 24
    expect(1000 - scrollRow).toBeLessThan(20)
    expect(scrollRow).toBeGreaterThanOrEqual(window)
    expect(scrollRow).toBeLessThan(window + 80)
    workbench.update("catalog.active", "item-999")
    expect(last.getAttribute("aria-current")).toBe("page")
    expect(Number(tree.getAttribute("data-storybook-tree-materialized"))).toBeLessThanOrEqual(80)
    expect(Number(tree.getAttribute("data-storybook-tree-created"))).toBeLessThan(350)

    const ungrouped = createWorkbench(items.map(({id, label, route, searchText}) => ({
      id,
      label,
      route,
      ...(searchText === undefined ? {} : {searchText}),
    })))
    expect(leafRows(ungrouped)).toHaveLength(80)

    const manyGroups = createWorkbench(items.map((item, index) => ({
      ...item,
      group: {id: `group-${index}`, label: `Group ${index}`},
    })))
    expect(groupRows(manyGroups).length).toBeLessThan(1000)
    expect(groupRows(manyGroups).length + leafRows(manyGroups).length).toBeLessThanOrEqual(80)
  })
})

function createWorkbench(
  items: readonly WorkbenchNavigationItem[],
  active: string | null = null,
): Workbench {
  const document = createDocument()
  return api.createWorkbench({
    document,
    parent: document,
    initial: {
      "catalog.items": items,
      "catalog.active": active,
    },
  })
}

function descendants(root: Node): Element[] {
  const result: Element[] = []
  for (const child of root.childNodes) {
    if (!(child instanceof Element)) continue
    result.push(child, ...descendants(child))
  }
  return result
}

function groupRows(workbench: Workbench): HTMLElement[] {
  return descendants(workbench.elements.catalogItems)
    .filter((element): element is HTMLElement => element.hasAttribute("data-group-id") &&
      element.getAttribute("role") === "treeitem")
}

function groupContainers(workbench: Workbench): HTMLDivElement[] {
  return descendants(workbench.elements.catalogItems)
    .filter((element): element is HTMLDivElement => element.getAttribute("role") === "group")
}

function leafRows(workbench: Workbench): HTMLElement[] {
  return descendants(workbench.elements.catalogItems)
    .filter((element): element is HTMLElement => element.hasAttribute("data-id") &&
      element.getAttribute("role") === "treeitem")
}

function findGroup(workbench: Workbench, id: string): HTMLElement | undefined {
  return groupRows(workbench).find((element) => element.getAttribute("data-group-id") === id)
}

function findLeaf(workbench: Workbench, id: string): HTMLElement | undefined {
  return leafRows(workbench).find((element) => element.getAttribute("data-id") === id)
}

function clickGroup(group: HTMLElement): void {
  const header = group.children[0] as HTMLButtonElement | undefined
  if (header === undefined || header.localName !== "button") {
    throw new Error("Catalog group toggle is missing")
  }
  header.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}))
}

function focusControl(row: HTMLElement): HTMLElement {
  const control = row.querySelector("button") as HTMLElement | null
  if (control === null) throw new Error("Catalog row has no production Button")
  return control
}

function press(target: HTMLElement, key: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
  }))
}
