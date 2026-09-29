/**
Выбирает файловую цель conditional exports в порядке объявления условий.
Среда задаётся вызывающей сборкой; default применим после предшествующих условий.
Bun-условия по умолчанию используются для загрузки серверного compiler adapter.
*/
export function conditionalExportTarget(
  value: unknown,
  conditions: readonly string[] = ["bun", "node", "import"],
): string | null {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    for (const entry of value) {
      const target = conditionalExportTarget(entry, conditions)
      if (target !== null) return target
    }
    return null
  }
  if (value === null || typeof value !== "object") return null
  for (const [condition, entry] of Object.entries(value)) {
    if (condition !== "default" && !conditions.includes(condition)) continue
    const target = conditionalExportTarget(entry, conditions)
    if (target !== null) return target
  }
  return null
}
