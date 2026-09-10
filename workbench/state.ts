import type {Document} from "@zavx0z/dom"
import type {
  WorkbenchAddress,
  WorkbenchCatalogManagement,
  WorkbenchAddressMap,
  WorkbenchTabItem,
  WorkbenchStatus,
  WorkbenchViewState,
} from "./contract.ts"
import {
  WORKBENCH_STANDARD_WIDGET_REGISTRY,
  validateWorkbenchInspectorSubject,
  validateWorkbenchInspectorValues,
  validateWorkbenchWidgetRegistry,
} from "./inspector/registry.ts"
import {normalizeWorkbenchNavigationItems} from "./navigation/model.ts"
import {validateWorkbenchPresentation} from "./presentation.ts"
import {
  requiredText,
  selectedId,
  stringValue,
} from "./validation.ts"

export function createInitialWorkbenchState(
  initial: Partial<WorkbenchAddressMap> | undefined,
  document: Document,
): WorkbenchViewState {
  const registry = validateWorkbenchWidgetRegistry(
    initial?.["inspector.registry"] ?? WORKBENCH_STANDARD_WIDGET_REGISTRY,
  )
  const presentation = validateWorkbenchPresentation(initial?.presentation ?? Object.freeze({
    node: null,
    projection: "display",
  }), document)
  const state: WorkbenchViewState = {
    title: requiredText("Workbench title", initial?.title ?? "Storybook"),
    "catalog.management": validateManagement(initial?.["catalog.management"] ?? null),
    "catalog.label": requiredText("Catalog label", initial?.["catalog.label"] ?? "Каталог"),
    "catalog.search": stringValue("Catalog search", initial?.["catalog.search"] ?? ""),
    "catalog.items": normalizeWorkbenchNavigationItems(
      "Catalog",
      initial?.["catalog.items"] ?? Object.freeze([]),
    ),
    "catalog.active": null,
    "secondary.label": requiredText(
      "Secondary navigation label",
      initial?.["secondary.label"] ?? "Разделы",
    ),
    "secondary.items": normalizeWorkbenchNavigationItems(
      "Secondary navigation",
      initial?.["secondary.items"] ?? Object.freeze([]),
    ),
    "secondary.active": null,
    "preview.label": requiredText("Preview label", initial?.["preview.label"] ?? "Предпросмотр"),
    presentation,
    "tabs.label": requiredText("Название панели вкладок", initial?.["tabs.label"] ?? "Панель вкладок"),
    "tabs.items": validateTabItems(initial?.["tabs.items"] ?? Object.freeze([])),
    "tabs.active": null,
    "inspector.registry": registry,
    "inspector.subject": validateWorkbenchInspectorSubject(
      initial?.["inspector.subject"] ?? null,
      registry,
    ),
    "inspector.values": validateWorkbenchInspectorValues(
      initial?.["inspector.values"] ?? Object.freeze({}),
    ),
    status: validateWorkbenchStatus(initial?.status ?? {
      lead: "",
      owner: initial?.title ?? "Storybook",
      detail: "",
    }),
  }
  state["catalog.active"] = selectedId(
    "Catalog",
    initial?.["catalog.active"] ?? null,
    state["catalog.items"],
  )
  state["secondary.active"] = selectedId(
    "Secondary navigation",
    initial?.["secondary.active"] ?? null,
    state["secondary.items"],
  )
  state["tabs.active"] = selectedId(
    "Вкладка",
    initial?.["tabs.active"] ?? null,
    state["tabs.items"],
  )
  return state
}

export function updateWorkbenchState<Address extends WorkbenchAddress>(
  current: WorkbenchViewState,
  address: Address,
  value: WorkbenchAddressMap[Address],
  document: Document,
): WorkbenchViewState {
  const next = {...current}
  switch (address) {
    case "title":
      next.title = requiredText("Workbench title", value)
      break
    case "catalog.management":
      next["catalog.management"] = validateManagement(value)
      break
    case "catalog.label":
      next["catalog.label"] = requiredText("Catalog label", value)
      break
    case "catalog.search":
      next["catalog.search"] = stringValue("Catalog search", value)
      break
    case "catalog.items":
      next["catalog.items"] = normalizeWorkbenchNavigationItems("Catalog", value)
      if (next["catalog.active"] !== null && !next["catalog.items"].some(item =>
        item.id === next["catalog.active"])) next["catalog.active"] = null
      break
    case "catalog.active":
      next["catalog.active"] = selectedId("Catalog", value, next["catalog.items"])
      break
    case "secondary.label":
      next["secondary.label"] = requiredText("Secondary navigation label", value)
      break
    case "secondary.items":
      next["secondary.items"] = normalizeWorkbenchNavigationItems("Secondary navigation", value)
      if (next["secondary.active"] !== null && !next["secondary.items"].some(item =>
        item.id === next["secondary.active"])) next["secondary.active"] = null
      break
    case "secondary.active":
      next["secondary.active"] = selectedId(
        "Secondary navigation",
        value,
        next["secondary.items"],
      )
      break
    case "preview.label":
      next["preview.label"] = requiredText("Preview label", value)
      break
    case "presentation":
      next.presentation = validateWorkbenchPresentation(value, document)
      break
    case "tabs.label":
      next["tabs.label"] = requiredText("Название панели вкладок", value)
      break
    case "tabs.items":
      next["tabs.items"] = validateTabItems(value)
      if (next["tabs.active"] !== null && !next["tabs.items"].some(item =>
        item.id === next["tabs.active"])) next["tabs.active"] = null
      break
    case "tabs.active":
      next["tabs.active"] = selectedId("Вкладка", value, next["tabs.items"])
      break
    case "inspector.registry":
      next["inspector.registry"] = validateWorkbenchWidgetRegistry(value)
      next["inspector.subject"] = validateWorkbenchInspectorSubject(
        next["inspector.subject"],
        next["inspector.registry"],
      )
      break
    case "inspector.subject":
      next["inspector.subject"] = validateWorkbenchInspectorSubject(
        value,
        next["inspector.registry"],
      )
      break
    case "inspector.values":
      next["inspector.values"] = validateWorkbenchInspectorValues(value)
      break
    case "status":
      next.status = validateWorkbenchStatus(value)
      break
  }
  return next
}

function validateTabItems(value: unknown): readonly WorkbenchTabItem[] {
  if (!Array.isArray(value)) throw new TypeError("Список вкладок должен быть массивом")
  const ids = new Set<string>()
  return Object.freeze(value.map((candidate, index) => {
    if (candidate === null || typeof candidate !== "object") {
      throw new TypeError(`Вкладка ${index} должна быть объектом`)
    }
    const item = candidate as WorkbenchTabItem
    const id = requiredText("Идентификатор вкладки", item.id)
    if (ids.has(id)) throw new Error(`Повторный идентификатор вкладки: ${id}`)
    ids.add(id)
    return Object.freeze({
      id,
      label: requiredText("Название вкладки", item.label),
      route: stringValue("Адрес вкладки", item.route),
      ...(item.title === undefined ? {} : {title: stringValue("Подсказка вкладки", item.title)}),
      ...(item.disabled === undefined ? {} : {disabled: Boolean(item.disabled)}),
    })
  }))
}

function validateWorkbenchStatus(value: unknown): WorkbenchStatus {
  if (value === null || typeof value !== "object") throw new TypeError("Status must be an object")
  const status = value as WorkbenchStatus
  const owner = requiredText("Status owner", status.owner)
  const source = status.breadcrumbs ?? Object.freeze([{
    id: "status-owner",
    label: owner,
    route: "",
  }])
  if (!Array.isArray(source) || source.length === 0) {
    throw new TypeError("Status breadcrumbs must be a non-empty array")
  }
  const ids = new Set<string>()
  const breadcrumbs = source.map((candidate, index) => {
    if (candidate === null || typeof candidate !== "object") {
      throw new TypeError(`Status breadcrumb ${index} must be an object`)
    }
    const id = requiredText("Status breadcrumb id", candidate.id)
    if (ids.has(id)) throw new Error(`Duplicate status breadcrumb id: ${id}`)
    ids.add(id)
    return Object.freeze({
      id,
      label: requiredText("Status breadcrumb label", candidate.label),
      ...(candidate.iconSrc === undefined ? {} : {iconSrc: requiredText("Status breadcrumb icon source", candidate.iconSrc)}),
      route: stringValue("Status breadcrumb route", candidate.route),
      ...(candidate.urlPath === undefined
        ? {}
        : {urlPath: requiredText("Status breadcrumb URL path", candidate.urlPath)}),
      ...(candidate.title === undefined
        ? {}
        : {title: stringValue("Status breadcrumb title", candidate.title)}),
      ...(candidate.disabled === undefined ? {} : {disabled: Boolean(candidate.disabled)}),
    })
  })
  return Object.freeze({
    lead: stringValue("Status lead", status.lead),
    owner,
    detail: stringValue("Status detail", status.detail),
    breadcrumbs: Object.freeze(breadcrumbs),
  })
}

function validateManagement(value: unknown): WorkbenchCatalogManagement | null {
  if (value === null) return null
  if (typeof value !== "object") throw new TypeError("Invalid catalog management state")
  const state = value as WorkbenchCatalogManagement
  if (typeof state.pending !== "boolean" || !Array.isArray(state.removableIds)) {
    throw new TypeError("Invalid catalog management state")
  }
  return Object.freeze({
    pending: state.pending,
    error: stringValue("Project error", state.error),
    removableIds: Object.freeze(state.removableIds.map(id => requiredText("Removable project", id))),
  })
}
