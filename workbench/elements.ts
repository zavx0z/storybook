import type {
  HTMLDivElement,
  HTMLInputElement,
  HTMLElement,
  Node,
} from "@zavx0z/dom"
import type {WorkbenchElements} from "./contract.ts"

export function readWorkbenchElements(root: HTMLDivElement): WorkbenchElements {
  return Object.freeze({
    root,
    body: exactElement(root, '[data-storybook-workbench-part="body"]', "Workbench body") as HTMLDivElement,
    catalog: exactElement(root, '[data-storybook-region="catalog"]', "Catalog region"),
    catalogSearch: exactElement(root, '[data-storybook-part="catalog-search"] input', "Catalog search") as HTMLInputElement,
    catalogItems: exactElement(root, '[data-storybook-tree="catalog"]', "Catalog items") as HTMLDivElement,
    secondary: exactElement(root, '[data-storybook-region="secondary"]', "Secondary region"),
    secondaryItems: exactElement(root, '[data-storybook-part="secondary-items"]', "Secondary items") as HTMLDivElement,
    preview: exactElement(root, '[data-storybook-region="preview"]', "Preview region"),
    previewHost: exactElement(root, '[data-storybook-part="preview-host"]', "Preview host"),
    displayHost: exactElement(root, '[data-storybook-projection="display"]', "Display projection host"),
    hudHost: exactElement(root, '[data-storybook-projection="hud"]', "HUD projection host"),
    spaceHost: exactElement(root, '[data-storybook-projection="space"]', "Space projection host"),
    scenarios: exactElement(root, '[data-storybook-region="scenarios"]', "Scenarios region"),
    scenarioItems: exactElement(root, '[data-storybook-part="scenario-items"]', "Scenario items") as HTMLDivElement,
    inspectorHost: exactElement(root, '[data-storybook-region="inspector"]', "Inspector region") as HTMLDivElement,
    status: exactElement(root, '[data-storybook-region="status"]', "Status region"),
  })
}

export function exactWorkbenchElement(root: Node, selector: string, label: string): HTMLElement {
  return exactElement(root, selector, label)
}

function exactElement(root: Node, selector: string, label: string): HTMLElement {
  if (!("querySelectorAll" in root)) throw new TypeError(`${label} root cannot be queried`)
  const matches = [...(root as Node & {
    querySelectorAll(selector: string): readonly HTMLElement[]
  }).querySelectorAll(selector)]
  if (matches.length !== 1) {
    throw new Error(`${label} must have one exact element, received ${matches.length}`)
  }
  return matches[0]!
}
