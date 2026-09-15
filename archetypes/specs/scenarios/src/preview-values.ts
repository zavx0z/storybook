import type {ScenarioExecution, ScenarioPreview, TraceValue} from "./types"

/** Значение можно напечатать как literal без подмены специальных меток объектами. */
export function isPortable(value: TraceValue): boolean {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(item => item !== undefined && isPortable(item))
  if (typeof value !== "object" || Object.hasOwn(value, "$type")) return false
  return Object.values(value).every(isPortable)
}

/** Собирает пункты выбранного варианта с путём вложенных групп и исходными описаниями. */
export function previewPoints(execution: ScenarioExecution, variantId: number): ScenarioPreview["variants"][number]["points"] {
  return execution.tests.flatMap(test => {
    const labels = [test.label]
    let current = test.groupId
    while (current !== null && current !== variantId) {
      const group = execution.groups.find(item => item.id === current)
      if (!group) return []
      labels.unshift(group.label)
      current = group.parentId
    }
    if (current !== variantId) return []
    const content = test.assertions.map(assertion => assertion.customFailMessage)
      .filter((value): value is string => value !== null).join("\n")
    return [{title: labels.join(" / "), ...(content ? {content} : {})}]
  })
}
