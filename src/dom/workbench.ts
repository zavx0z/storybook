/**
Semantic Storybook Workbench built from standard HTML DOM concepts.

The factory creates one stable shell in a caller-owned `@zavx0z/dom`
`Document`. Catalog, secondary navigation, preview, scenarios, owner-supplied
Inspector and status are updated by explicit addresses. Interaction uses normal DOM
listeners and bubbling events; rendering remains a downstream concern.

@packageDocumentation
*/

import {
  CustomEvent,
  type Document,
  type Element,
  type HTMLButtonElement,
  type HTMLDivElement,
  type HTMLElement,
  type HTMLInputElement,
  Node,
  type Text,
} from "@zavx0z/dom"

/** Flat author CSS accepted directly by the CPU renderer's initial cascade. */
export const storybookDomWorkbenchCss = `
.storybook-dom-workbench { box-sizing: border-box; display: flex; flex-direction: column; width: 100%; height: 100%; background: #1d1d1d; color: #d8d8d8; font-size: 11px; line-height: 16px; }
.storybook-dom-workbench__body { box-sizing: border-box; display: flex; flex-direction: row; flex: 1 1 0; min-height: 0; gap: 4px; padding: 4px; overflow: hidden; background: #161616; }
.storybook-dom-workbench__catalog { box-sizing: border-box; display: flex; flex-direction: column; flex: 0 0 196px; width: 196px; gap: 2px; padding: 4px; overflow: hidden; border: 1px solid #111111; border-radius: 6px; background: #303030; }
.storybook-dom-workbench__secondary { box-sizing: border-box; display: flex; flex-direction: column; flex: 0 0 152px; width: 152px; gap: 2px; padding: 4px; overflow: hidden; border: 1px solid #111111; border-radius: 6px; background: #292929; }
.storybook-dom-workbench__center { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; gap: 4px; overflow: hidden; }
.storybook-dom-workbench__preview { box-sizing: border-box; display: flex; flex-direction: column; flex-grow: 1; gap: 2px; padding: 4px; overflow: hidden; border: 1px solid #111111; border-radius: 6px; background: #1d1d1d; }
.storybook-dom-workbench__preview-host { display: flex; flex-direction: column; flex-grow: 1; align-items: center; justify-content: center; }
.storybook-dom-workbench__scenarios { box-sizing: border-box; display: flex; flex-direction: row; height: 28px; gap: 4px; padding: 2px 4px; overflow: hidden; border: 1px solid #111111; border-radius: 6px; background: #292929; }
.storybook-dom-workbench__scenario-items { display: flex; flex-direction: row; flex: 1 1 0; gap: 2px; }
.storybook-dom-workbench__inspector-host { box-sizing: border-box; display: flex; flex-direction: column; flex: 0 0 400px; width: 400px; min-height: 0; overflow: hidden; }
.storybook-dom-workbench__search { box-sizing: border-box; display: block; width: 100%; height: 24px; padding: 2px 6px; border: 1px solid #151515; border-radius: 4px; background: #202020; color: #e0e0e0; font-size: 11px; }
.storybook-dom-workbench__items { display: flex; flex-direction: column; gap: 1px; }
.storybook-dom-workbench__item { box-sizing: border-box; display: block; width: 100%; min-height: 24px; padding: 3px 6px; border: 1px solid transparent; border-radius: 2px; background: #303030; color: #c8c8c8; font-size: 11px; }
.storybook-dom-workbench__item[data-active] { border-color: #47788f; background: #31566a; color: #f0f0f0; }
.storybook-dom-workbench__item[disabled] { background: #292929; color: #707070; opacity: 0.55; }
.storybook-dom-workbench__heading { box-sizing: border-box; display: block; min-height: 20px; margin: 0; padding: 2px 4px; color: #d8d8d8; font-size: 11px; line-height: 16px; }
.storybook-dom-workbench__status { box-sizing: border-box; display: flex; flex-direction: row; align-items: center; width: 100%; height: 24px; gap: 0; padding: 0 12px 0 8px; border-top: 2px solid #161616; background: #181818; color: #878787; font-size: 11px; line-height: 20px; }
.storybook-dom-workbench__status-owner { color: #c8c8c8; }
`.trim()

export const STORYBOOK_DOM_WORKBENCH_EVENTS = Object.freeze({
  navigate: "storybooknavigate",
  search: "storybooksearch",
  scenario: "storybookscenario",
} as const)

export type StorybookDomNavigationItem = Readonly<{
  id: string
  label: string
  route: string
  title?: string
  disabled?: boolean
}>

export type StorybookDomScenarioItem = Readonly<{
  id: string
  label: string
  title?: string
  disabled?: boolean
}>

export type StorybookDomStatus = Readonly<{
  lead: string
  owner: string
  detail: string
}>

/** Every mutable Workbench region has one explicit semantic address. */
export type StorybookDomWorkbenchAddressMap = Readonly<{
  title: string
  "catalog.label": string
  "catalog.search": string
  "catalog.items": readonly StorybookDomNavigationItem[]
  "catalog.active": string | null
  "secondary.label": string
  "secondary.items": readonly StorybookDomNavigationItem[]
  "secondary.active": string | null
  "preview.label": string
  "preview.node": Node | null
  "scenarios.label": string
  "scenarios.items": readonly StorybookDomScenarioItem[]
  "scenarios.active": string | null
  "inspector.node": Node | null
  status: StorybookDomStatus
}>

export type StorybookDomWorkbenchAddress = keyof StorybookDomWorkbenchAddressMap

export type StorybookDomWorkbenchController = Readonly<{
  read<Address extends StorybookDomWorkbenchAddress>(
    address: Address,
  ): StorybookDomWorkbenchAddressMap[Address]
  update<Address extends StorybookDomWorkbenchAddress>(
    address: Address,
    value: StorybookDomWorkbenchAddressMap[Address],
  ): void
  dispose(): void
}>

/** Stable public node references; none are replaced by addressed updates. */
export type StorybookDomWorkbenchElements = Readonly<{
  root: HTMLDivElement
  body: HTMLDivElement
  catalog: HTMLElement
  catalogSearch: HTMLInputElement
  catalogItems: HTMLDivElement
  secondary: HTMLElement
  secondaryItems: HTMLDivElement
  preview: HTMLElement
  previewHost: HTMLElement
  scenarios: HTMLElement
  scenarioItems: HTMLDivElement
  inspectorHost: HTMLDivElement
  status: HTMLElement
}>

export type CreateStorybookDomWorkbenchOptions = Readonly<{
  document: Document
  parent?: Node
  initial?: Partial<StorybookDomWorkbenchAddressMap>
}>

export type StorybookDomWorkbench = Readonly<{
  document: Document
  element: HTMLDivElement
  elements: StorybookDomWorkbenchElements
  controller: StorybookDomWorkbenchController
  update<Address extends StorybookDomWorkbenchAddress>(
    address: Address,
    value: StorybookDomWorkbenchAddressMap[Address],
  ): void
  dispose(): void
}>

type MutableWorkbenchState = {
  -readonly [Address in StorybookDomWorkbenchAddress]: StorybookDomWorkbenchAddressMap[Address]
}

type NavigationRecord = {
  item: StorybookDomNavigationItem
  button: HTMLButtonElement
  text: Text
  onClick: () => void
}

type ScenarioRecord = {
  item: StorybookDomScenarioItem
  button: HTMLButtonElement
  text: Text
  onClick: () => void
}

/**
Creates the complete semantic Workbench shell in one supplied Document.

The caller may append `element` later or pass a same-document `parent` for an
atomic mount. The shell never creates another Document and rejects preview
nodes from another realm.
*/
export function createStorybookDomWorkbench(
  options: CreateStorybookDomWorkbenchOptions,
): StorybookDomWorkbench {
  const {document} = options
  const parent = options.parent
  if (parent !== undefined) assertNodeInDocument(parent, document, "Workbench parent")

  const root = element(document, "div", "storybook-dom-workbench") as HTMLDivElement
  root.setAttribute("role", "application")
  root.setAttribute("data-storybook-workbench", "")

  const body = element(document, "div", "storybook-dom-workbench__body") as HTMLDivElement
  const catalog = element(document, "nav", "storybook-dom-workbench__catalog")
  const catalogHeading = labeledElement(document, "h2", "storybook-dom-workbench__heading", "")
  const catalogSearch = element(document, "input", "storybook-dom-workbench__search") as HTMLInputElement
  catalogSearch.type = "search"
  catalogSearch.placeholder = "Поиск…"
  catalogSearch.title = "Поиск по каталогу"
  catalogSearch.setAttribute("aria-label", "Поиск по каталогу")
  const catalogItems = element(document, "div", "storybook-dom-workbench__items") as HTMLDivElement
  catalogItems.setAttribute("role", "list")

  const secondary = element(document, "nav", "storybook-dom-workbench__secondary")
  const secondaryHeading = labeledElement(document, "h2", "storybook-dom-workbench__heading", "")
  const secondaryItems = element(document, "div", "storybook-dom-workbench__items") as HTMLDivElement
  secondaryItems.setAttribute("role", "list")

  const center = element(document, "div", "storybook-dom-workbench__center")
  const preview = element(document, "main", "storybook-dom-workbench__preview")
  preview.setAttribute("role", "main")
  const previewHeading = labeledElement(document, "h2", "storybook-dom-workbench__heading", "")
  const previewHost = element(document, "section", "storybook-dom-workbench__preview-host")
  previewHost.setAttribute("role", "region")
  previewHost.setAttribute("aria-live", "polite")

  const scenarios = element(document, "section", "storybook-dom-workbench__scenarios")
  scenarios.setAttribute("role", "toolbar")
  const scenarioLabel = labeledElement(document, "span", "storybook-dom-workbench__heading", "")
  const scenarioItems = element(document, "div", "storybook-dom-workbench__scenario-items") as HTMLDivElement

  const inspectorHost = element(document, "div", "storybook-dom-workbench__inspector-host") as HTMLDivElement

  const status = element(document, "footer", "storybook-dom-workbench__status")
  status.setAttribute("role", "status")
  status.setAttribute("aria-live", "polite")
  const statusLead = labeledElement(document, "span", "", "")
  const statusOwner = labeledElement(document, "span", "storybook-dom-workbench__status-owner", "")
  const statusDetail = labeledElement(document, "span", "", "")

  document.transaction(() => {
    catalog.appendChild(catalogHeading.element)
    catalog.appendChild(catalogSearch)
    catalog.appendChild(catalogItems)
    secondary.appendChild(secondaryHeading.element)
    secondary.appendChild(secondaryItems)
    preview.appendChild(previewHeading.element)
    preview.appendChild(previewHost)
    scenarios.appendChild(scenarioLabel.element)
    scenarios.appendChild(scenarioItems)
    center.appendChild(preview)
    center.appendChild(scenarios)
    body.appendChild(catalog)
    body.appendChild(secondary)
    body.appendChild(center)
    body.appendChild(inspectorHost)
    status.appendChild(statusLead.element)
    status.appendChild(statusOwner.element)
    status.appendChild(statusDetail.element)
    root.appendChild(body)
    root.appendChild(status)
    parent?.appendChild(root)
  })

  const catalogRecords = new Map<string, NavigationRecord>()
  const secondaryRecords = new Map<string, NavigationRecord>()
  const scenarioRecords = new Map<string, ScenarioRecord>()
  let disposed = false
  const state: MutableWorkbenchState = {
    title: "Storybook",
    "catalog.label": "Каталог",
    "catalog.search": "",
    "catalog.items": Object.freeze([]),
    "catalog.active": null,
    "secondary.label": "Разделы",
    "secondary.items": Object.freeze([]),
    "secondary.active": null,
    "preview.label": "Предпросмотр",
    "preview.node": null,
    "scenarios.label": "Сценарии",
    "scenarios.items": Object.freeze([]),
    "scenarios.active": null,
    "inspector.node": null,
    status: Object.freeze({lead: "Создано для ", owner: "MetaFor", detail: " · Storybook"}),
  }

  const onSearchInput = (): void => {
    update("catalog.search", catalogSearch.value)
    catalogSearch.dispatchEvent(new CustomEvent(STORYBOOK_DOM_WORKBENCH_EVENTS.search, {
      bubbles: true,
      detail: Object.freeze({value: catalogSearch.value}),
    }))
  }
  catalogSearch.addEventListener("input", onSearchInput)

  const read = <Address extends StorybookDomWorkbenchAddress>(
    address: Address,
  ): StorybookDomWorkbenchAddressMap[Address] => {
    assertActive(disposed)
    return state[address]
  }

  const update = <Address extends StorybookDomWorkbenchAddress>(
    address: Address,
    value: StorybookDomWorkbenchAddressMap[Address],
  ): void => {
    assertActive(disposed)
    document.transaction(() => applyUpdate(address, value))
  }

  const applyUpdate = (
    address: StorybookDomWorkbenchAddress,
    value: StorybookDomWorkbenchAddressMap[StorybookDomWorkbenchAddress],
  ): void => {
    switch (address) {
      case "title": {
        const next = requiredText("Workbench title", value)
        state.title = next
        root.setAttribute("aria-label", next)
        return
      }
      case "catalog.label": {
        const next = requiredText("Catalog label", value)
        state[address] = next
        catalogHeading.text.data = next
        catalog.setAttribute("aria-label", next)
        return
      }
      case "catalog.search": {
        const next = stringValue("Catalog search", value)
        state[address] = next
        catalogSearch.value = next
        applyCatalogFilter(catalogRecords, next)
        return
      }
      case "catalog.items": {
        const next = navigationItems("Catalog", value)
        state[address] = next
        reconcileNavigation(catalogItems, catalogRecords, next, "catalog")
        if (state["catalog.active"] !== null && !catalogRecords.has(state["catalog.active"]!)) {
          state["catalog.active"] = null
        }
        applyNavigationSelection(catalogRecords, state["catalog.active"])
        applyCatalogFilter(catalogRecords, state["catalog.search"])
        return
      }
      case "catalog.active": {
        const next = selectedId("Catalog", value, catalogRecords)
        state[address] = next
        applyNavigationSelection(catalogRecords, next)
        return
      }
      case "secondary.label": {
        const next = requiredText("Secondary navigation label", value)
        state[address] = next
        secondaryHeading.text.data = next
        secondary.setAttribute("aria-label", next)
        return
      }
      case "secondary.items": {
        const next = navigationItems("Secondary navigation", value)
        state[address] = next
        reconcileNavigation(secondaryItems, secondaryRecords, next, "secondary")
        if (state["secondary.active"] !== null && !secondaryRecords.has(state["secondary.active"]!)) {
          state["secondary.active"] = null
        }
        applyNavigationSelection(secondaryRecords, state["secondary.active"])
        return
      }
      case "secondary.active": {
        const next = selectedId("Secondary navigation", value, secondaryRecords)
        state[address] = next
        applyNavigationSelection(secondaryRecords, next)
        return
      }
      case "preview.label": {
        const next = requiredText("Preview label", value)
        state[address] = next
        previewHeading.text.data = next
        preview.setAttribute("aria-label", next)
        previewHost.setAttribute("aria-label", next)
        return
      }
      case "preview.node": {
        const next = previewNode(value)
        if (next !== null) assertNodeInDocument(next, document, "Preview node")
        const previous = state[address]
        if (previous === next) return
        if (previous?.parentNode === previewHost) previewHost.removeChild(previous)
        if (next !== null) previewHost.appendChild(next)
        state[address] = next
        return
      }
      case "scenarios.label": {
        const next = requiredText("Scenario label", value)
        state[address] = next
        scenarioLabel.text.data = next
        scenarios.setAttribute("aria-label", next)
        return
      }
      case "scenarios.items": {
        const next = scenarioItemsValue(value)
        state[address] = next
        reconcileScenarios(next)
        if (state["scenarios.active"] !== null && !scenarioRecords.has(state["scenarios.active"]!)) {
          state["scenarios.active"] = null
        }
        applyScenarioSelection(state["scenarios.active"])
        return
      }
      case "scenarios.active": {
        const next = selectedId("Scenario", value, scenarioRecords)
        state[address] = next
        applyScenarioSelection(next)
        return
      }
      case "inspector.node": {
        const next = previewNode(value)
        if (next !== null) assertNodeInDocument(next, document, "Inspector node")
        const previous = state[address]
        if (previous === next) return
        if (previous?.parentNode === inspectorHost) inspectorHost.removeChild(previous)
        if (next !== null) inspectorHost.appendChild(next)
        state[address] = next
        return
      }
      case "status": {
        const next = statusValue(value)
        state[address] = next
        statusLead.text.data = next.lead
        statusOwner.text.data = next.owner
        statusOwner.element.title = next.owner
        statusDetail.text.data = next.detail
        status.setAttribute("aria-label", `${next.lead}${next.owner}${next.detail}`)
        return
      }
    }
  }

  const reconcileNavigation = (
    host: HTMLDivElement,
    records: Map<string, NavigationRecord>,
    items: readonly StorybookDomNavigationItem[],
    kind: "catalog" | "secondary",
  ): void => {
    const retained = new Set(items.map(({id}) => id))
    for (const [id, record] of records) {
      if (retained.has(id)) continue
      record.button.removeEventListener("click", record.onClick)
      if (record.button.parentNode === host) host.removeChild(record.button)
      records.delete(id)
    }

    for (const item of items) {
      let record = records.get(item.id)
      if (record === undefined) {
        const button = element(document, "button", "storybook-dom-workbench__item") as HTMLButtonElement
        const text = document.createTextNode("")
        button.setAttribute("type", "button")
        button.setAttribute("role", "listitem")
        button.appendChild(text)
        record = {
          item,
          button,
          text,
          onClick: () => {
            const current = records.get(item.id)
            if (current === undefined || current.button.disabled) return
            const address = kind === "catalog" ? "catalog.active" : "secondary.active"
            update(address, current.item.id)
            current.button.dispatchEvent(new CustomEvent(STORYBOOK_DOM_WORKBENCH_EVENTS.navigate, {
              bubbles: true,
              detail: Object.freeze({
                kind,
                id: current.item.id,
                route: current.item.route,
              }),
            }))
          },
        }
        button.addEventListener("click", record.onClick)
        records.set(item.id, record)
      }
      record.item = item
      record.text.data = item.label
      record.button.title = item.title ?? item.label
      record.button.disabled = item.disabled ?? false
      record.button.setAttribute("data-id", item.id)
      record.button.setAttribute("data-route", item.route)
      record.button.setAttribute("aria-label", item.label)
    }
    orderChildren(host, items.map(({id}) => records.get(id)!.button))
  }

  const reconcileScenarios = (items: readonly StorybookDomScenarioItem[]): void => {
    const retained = new Set(items.map(({id}) => id))
    for (const [id, record] of scenarioRecords) {
      if (retained.has(id)) continue
      record.button.removeEventListener("click", record.onClick)
      if (record.button.parentNode === scenarioItems) scenarioItems.removeChild(record.button)
      scenarioRecords.delete(id)
    }
    for (const item of items) {
      let record = scenarioRecords.get(item.id)
      if (record === undefined) {
        const button = element(document, "button", "storybook-dom-workbench__item") as HTMLButtonElement
        const text = document.createTextNode("")
        button.setAttribute("type", "button")
        button.appendChild(text)
        record = {
          item,
          button,
          text,
          onClick: () => {
            const current = scenarioRecords.get(item.id)
            if (current === undefined || current.button.disabled) return
            update("scenarios.active", current.item.id)
            current.button.dispatchEvent(new CustomEvent(STORYBOOK_DOM_WORKBENCH_EVENTS.scenario, {
              bubbles: true,
              detail: Object.freeze({id: current.item.id}),
            }))
          },
        }
        button.addEventListener("click", record.onClick)
        scenarioRecords.set(item.id, record)
      }
      record.item = item
      record.text.data = item.label
      record.button.title = item.title ?? item.label
      record.button.disabled = item.disabled ?? false
      record.button.setAttribute("data-id", item.id)
      record.button.setAttribute("aria-label", item.label)
    }
    orderChildren(scenarioItems, items.map(({id}) => scenarioRecords.get(id)!.button))
  }

  const applyNavigationSelection = (
    records: ReadonlyMap<string, NavigationRecord>,
    active: string | null,
  ): void => {
    for (const [id, record] of records) {
      const selected = id === active
      setPresence(record.button, "data-active", selected)
      if (selected) record.button.setAttribute("aria-current", "page")
      else record.button.removeAttribute("aria-current")
    }
  }

  const applyScenarioSelection = (active: string | null): void => {
    for (const [id, record] of scenarioRecords) {
      const selected = id === active
      setPresence(record.button, "data-active", selected)
      record.button.setAttribute("aria-pressed", String(selected))
    }
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    catalogSearch.removeEventListener("input", onSearchInput)
    for (const record of catalogRecords.values()) record.button.removeEventListener("click", record.onClick)
    for (const record of secondaryRecords.values()) record.button.removeEventListener("click", record.onClick)
    for (const record of scenarioRecords.values()) record.button.removeEventListener("click", record.onClick)
    catalogRecords.clear()
    secondaryRecords.clear()
    scenarioRecords.clear()
    if (root.parentNode !== null) root.parentNode.removeChild(root)
  }

  const controller: StorybookDomWorkbenchController = Object.freeze({read, update, dispose})
  const workbench: StorybookDomWorkbench = Object.freeze({
    document,
    element: root,
    elements: Object.freeze({
      root,
      body,
      catalog,
      catalogSearch,
      catalogItems,
      secondary,
      secondaryItems,
      preview,
      previewHost,
      scenarios,
      scenarioItems,
      inspectorHost,
      status,
    }),
    controller,
    update,
    dispose,
  })

  const initial = options.initial ?? {}
  update("title", initial.title ?? state.title)
  update("catalog.label", initial["catalog.label"] ?? state["catalog.label"])
  update("catalog.items", initial["catalog.items"] ?? state["catalog.items"])
  update("catalog.active", initial["catalog.active"] ?? state["catalog.active"])
  update("catalog.search", initial["catalog.search"] ?? state["catalog.search"])
  update("secondary.label", initial["secondary.label"] ?? state["secondary.label"])
  update("secondary.items", initial["secondary.items"] ?? state["secondary.items"])
  update("secondary.active", initial["secondary.active"] ?? state["secondary.active"])
  update("preview.label", initial["preview.label"] ?? state["preview.label"])
  update("preview.node", initial["preview.node"] ?? state["preview.node"])
  update("scenarios.label", initial["scenarios.label"] ?? state["scenarios.label"])
  update("scenarios.items", initial["scenarios.items"] ?? state["scenarios.items"])
  update("scenarios.active", initial["scenarios.active"] ?? state["scenarios.active"])
  update("inspector.node", initial["inspector.node"] ?? state["inspector.node"])
  update("status", initial.status ?? state.status)
  return workbench
}

function element(document: Document, tag: string, className: string): HTMLElement {
  const result = document.createElement(tag)
  if (className.length > 0) result.className = className
  return result
}

function labeledElement(
  document: Document,
  tag: string,
  className: string,
  value: string,
): Readonly<{element: HTMLElement; text: Text}> {
  const result = element(document, tag, className)
  const text = document.createTextNode(value)
  result.appendChild(text)
  return {element: result, text}
}


function requiredText(label: string, value: unknown): string {
  const text = stringValue(label, value)
  if (text.trim().length === 0) throw new Error(`${label} must not be empty`)
  return text
}

function stringValue(label: string, value: unknown): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`)
  return value
}

function navigationItems(label: string, value: unknown): readonly StorybookDomNavigationItem[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} items must be an array`)
  const ids = new Set<string>()
  const items = value.map((candidate, index) => {
    if (candidate === null || typeof candidate !== "object") {
      throw new TypeError(`${label} item ${index} must be an object`)
    }
    const item = candidate as StorybookDomNavigationItem
    const id = requiredText(`${label} item id`, item.id)
    if (ids.has(id)) throw new Error(`Duplicate ${label.toLowerCase()} item id: ${id}`)
    ids.add(id)
    return Object.freeze({
      id,
      label: requiredText(`${label} item label`, item.label),
      route: requiredText(`${label} item route`, item.route),
      ...(item.title === undefined ? {} : {title: stringValue(`${label} item title`, item.title)}),
      ...(item.disabled === undefined ? {} : {disabled: Boolean(item.disabled)}),
    })
  })
  return Object.freeze(items)
}

function scenarioItemsValue(value: unknown): readonly StorybookDomScenarioItem[] {
  if (!Array.isArray(value)) throw new TypeError("Scenario items must be an array")
  const ids = new Set<string>()
  const items = value.map((candidate, index) => {
    if (candidate === null || typeof candidate !== "object") {
      throw new TypeError(`Scenario item ${index} must be an object`)
    }
    const item = candidate as StorybookDomScenarioItem
    const id = requiredText("Scenario item id", item.id)
    if (ids.has(id)) throw new Error(`Duplicate scenario item id: ${id}`)
    ids.add(id)
    return Object.freeze({
      id,
      label: requiredText("Scenario item label", item.label),
      ...(item.title === undefined ? {} : {title: stringValue("Scenario item title", item.title)}),
      ...(item.disabled === undefined ? {} : {disabled: Boolean(item.disabled)}),
    })
  })
  return Object.freeze(items)
}

function statusValue(value: unknown): StorybookDomStatus {
  if (value === null || typeof value !== "object") throw new TypeError("Status must be an object")
  const status = value as StorybookDomStatus
  return Object.freeze({
    lead: stringValue("Status lead", status.lead),
    owner: requiredText("Status owner", status.owner),
    detail: stringValue("Status detail", status.detail),
  })
}

function selectedId(
  label: string,
  value: unknown,
  records: ReadonlyMap<string, unknown>,
): string | null {
  if (value === null) return null
  const id = requiredText(`${label} active id`, value)
  if (!records.has(id)) throw new Error(`Unknown ${label.toLowerCase()} item id: ${id}`)
  return id
}

function previewNode(value: unknown): Node | null {
  if (value === null) return null
  if (!(value instanceof Node)) throw new TypeError("Preview node must be a Node from @zavx0z/dom")
  return value
}

function applyCatalogFilter(records: ReadonlyMap<string, NavigationRecord>, value: string): void {
  const query = value.trim().toLocaleLowerCase()
  for (const record of records.values()) {
    const searchText = `${record.item.label} ${record.item.route}`.toLocaleLowerCase()
    record.button.setAttribute("style", query.length === 0 || searchText.includes(query)
      ? "display: block"
      : "display: none")
  }
}

function orderChildren(host: Node, children: readonly Node[]): void {
  let cursor = host.firstChild
  for (const child of children) {
    if (child === cursor) {
      cursor = cursor.nextSibling
      continue
    }
    host.insertBefore(child, cursor)
  }
}

function setPresence(element: Element, name: string, present: boolean): void {
  if (present) element.setAttribute(name, "")
  else element.removeAttribute(name)
}

function assertNodeInDocument(node: Node, document: Document, label: string): void {
  if (!(node instanceof Node)) throw new TypeError(`${label} must be a Node from @zavx0z/dom`)
  if (node !== document && node.ownerDocument !== document) throw new Error(`${label} belongs to another Document`)
}

function assertActive(disposed: boolean): void {
  if (disposed) throw new Error("DOM Workbench is disposed")
}
