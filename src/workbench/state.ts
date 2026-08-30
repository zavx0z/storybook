import type {Document} from "@zavx0z/dom"
import type {
  WorkbenchAddress,
  WorkbenchAddressMap,
  WorkbenchScenarioItem,
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
    "scenarios.label": requiredText("Scenario label", initial?.["scenarios.label"] ?? "Сценарии"),
    "scenarios.items": validateScenarioItems(initial?.["scenarios.items"] ?? Object.freeze([])),
    "scenarios.active": null,
    "inspector.registry": registry,
    "inspector.subject": validateWorkbenchInspectorSubject(
      initial?.["inspector.subject"] ?? null,
      registry,
    ),
    "inspector.values": validateWorkbenchInspectorValues(
      initial?.["inspector.values"] ?? Object.freeze({}),
    ),
    status: validateWorkbenchStatus(initial?.status ?? {
      lead: "Создано для ",
      owner: "MetaFor",
      detail: " · Storybook",
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
  state["scenarios.active"] = selectedId(
    "Scenario",
    initial?.["scenarios.active"] ?? null,
    state["scenarios.items"],
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
    case "scenarios.label":
      next["scenarios.label"] = requiredText("Scenario label", value)
      break
    case "scenarios.items":
      next["scenarios.items"] = validateScenarioItems(value)
      if (next["scenarios.active"] !== null && !next["scenarios.items"].some(item =>
        item.id === next["scenarios.active"])) next["scenarios.active"] = null
      break
    case "scenarios.active":
      next["scenarios.active"] = selectedId("Scenario", value, next["scenarios.items"])
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

function validateScenarioItems(value: unknown): readonly WorkbenchScenarioItem[] {
  if (!Array.isArray(value)) throw new TypeError("Scenario items must be an array")
  const ids = new Set<string>()
  return Object.freeze(value.map((candidate, index) => {
    if (candidate === null || typeof candidate !== "object") {
      throw new TypeError(`Scenario item ${index} must be an object`)
    }
    const item = candidate as WorkbenchScenarioItem
    const id = requiredText("Scenario item id", item.id)
    if (ids.has(id)) throw new Error(`Duplicate scenario item id: ${id}`)
    ids.add(id)
    return Object.freeze({
      id,
      label: requiredText("Scenario item label", item.label),
      ...(item.title === undefined ? {} : {title: stringValue("Scenario item title", item.title)}),
      ...(item.disabled === undefined ? {} : {disabled: Boolean(item.disabled)}),
    })
  }))
}

function validateWorkbenchStatus(value: unknown): WorkbenchStatus {
  if (value === null || typeof value !== "object") throw new TypeError("Status must be an object")
  const status = value as WorkbenchStatus
  return Object.freeze({
    lead: stringValue("Status lead", status.lead),
    owner: requiredText("Status owner", status.owner),
    detail: stringValue("Status detail", status.detail),
  })
}
