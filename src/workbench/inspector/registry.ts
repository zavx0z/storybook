import {isCompiledTemplate} from "@zavx0z/template/compiled"
import type {
  WorkbenchInspectorSubject,
  WorkbenchInspectorValues,
  WorkbenchInspectorWidgetRegistration,
  WorkbenchViewState,
} from "../contract.ts"
import {requiredText} from "../validation.ts"

export const WORKBENCH_STANDARD_WIDGET_REGISTRY = Object.freeze([
  Object.freeze({id: "props", kind: "props", label: "P", title: "Props"}),
  Object.freeze({id: "source", kind: "source", label: "S", title: "Source"}),
  Object.freeze({id: "events", kind: "events", label: "E", title: "Events"}),
  Object.freeze({id: "diagnostics", kind: "diagnostics", label: "!", title: "Diagnostics"}),
  Object.freeze({id: "dom", kind: "dom", label: "D", title: "DOM"}),
  Object.freeze({id: "layout", kind: "layout", label: "L", title: "Layout"}),
  Object.freeze({id: "display", kind: "display", label: "V", title: "Display"}),
  Object.freeze({id: "reference", kind: "reference", label: "R", title: "Reference"}),
] as const satisfies readonly WorkbenchInspectorWidgetRegistration[])

export function validateWorkbenchWidgetRegistry(
  value: unknown,
): readonly WorkbenchInspectorWidgetRegistration[] {
  if (!Array.isArray(value)) throw new TypeError("Inspector widget registry must be an array")
  const ids = new Set<string>()
  const result = value.map((candidate, index) => {
    if (candidate === null || typeof candidate !== "object") {
      throw new TypeError(`Inspector widget ${index} must be an object`)
    }
    const widget = candidate as WorkbenchInspectorWidgetRegistration
    const id = requiredText(`Inspector widget ${index} id`, widget.id)
    if (ids.has(id)) throw new Error(`Duplicate Inspector widget id: ${id}`)
    ids.add(id)
    if (!["props", "source", "events", "diagnostics", "dom", "layout", "display", "reference", "custom"]
      .includes(widget.kind)) throw new Error(`Unknown Inspector widget kind: ${String(widget.kind)}`)
    if (widget.kind !== "custom" && widget.kind !== id) {
      throw new Error(`Standard Inspector widget id must equal its kind: ${id}`)
    }
    const label = requiredText(`Inspector widget ${index} label`, widget.label)
    const title = requiredText(`Inspector widget ${index} title`, widget.title)
    if (widget.kind !== "custom") return Object.freeze({id, kind: widget.kind, label, title})
    if (!isCompiledTemplate(widget.component)) {
      throw new TypeError(`Custom Inspector widget component must be a governed compiled template: ${id}`)
    }
    return Object.freeze({id, kind: "custom" as const, label, title, component: widget.component})
  })
  const standard = WORKBENCH_STANDARD_WIDGET_REGISTRY.map(({id}) => id)
  const presentStandard = result.filter(({kind}) => kind !== "custom").map(({id}) => id)
  if (presentStandard.length !== standard.length ||
    presentStandard.some((id, index) => id !== standard[index])) {
    throw new Error("Standard Inspector widget registry order is fixed")
  }
  return Object.freeze(result)
}

export function validateWorkbenchInspectorSubject(
  value: unknown,
  registry: readonly WorkbenchInspectorWidgetRegistration[],
): WorkbenchInspectorSubject | null {
  if (value === null) return null
  if (value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Inspector subject must be an object or null")
  }
  const subject = value as WorkbenchInspectorSubject
  if (!Array.isArray(subject.widgetIds)) throw new TypeError("Inspector subject widgetIds must be an array")
  const available = new Set(registry.map(({id}) => id))
  const seen = new Set<string>()
  const widgetIds = subject.widgetIds.map((candidate, index) => {
    const id = requiredText(`Inspector subject widget ${index}`, candidate)
    if (!available.has(id)) throw new Error(`Inspector subject references unknown widget: ${id}`)
    if (seen.has(id)) throw new Error(`Inspector subject repeats widget: ${id}`)
    seen.add(id)
    return id
  })
  return Object.freeze({
    packageId: requiredText("Inspector subject packageId", subject.packageId),
    subjectId: requiredText("Inspector subject subjectId", subject.subjectId),
    widgetIds: Object.freeze(widgetIds),
  })
}

export function validateWorkbenchInspectorValues(value: unknown): WorkbenchInspectorValues {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Inspector values must be an object")
  }
  return Object.freeze({...value as Record<string, unknown>})
}

export function activeWorkbenchInspectorWidgets(
  state: WorkbenchViewState,
): readonly WorkbenchInspectorWidgetRegistration[] {
  const subject = state["inspector.subject"]
  if (subject === null) return Object.freeze([])
  return Object.freeze(subject.widgetIds.map(id =>
    state["inspector.registry"].find(widget => widget.id === id)!))
}
