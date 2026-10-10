/** Явный source описывает авторское воплощение того же export, а не новую среду или роль. */
export function sourceExports(exports: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const project = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value
    if (Array.isArray(value)) {
      const projected = value.map(project)
      return projected.some((child, index) => child !== value[index]) ? projected : value
    }
    if (Object.hasOwn(value, "source")) return project(Reflect.get(value, "source"))
    let changed = false
    const entries = Object.entries(value).map(([key, child]) => {
      const projected = project(child)
      changed ||= projected !== child
      return [key, projected]
    })
    return changed ? Object.fromEntries(entries) : value
  }
  const projected = project(exports)
  if (projected === exports) return exports
  return typeof projected === "string" || projected === null || Array.isArray(projected)
    ? {".": projected}
    : projected as Readonly<Record<string, unknown>>
}
