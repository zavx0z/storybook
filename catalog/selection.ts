import type {StorybookCatalog} from "./catalog.t.ts"

/** Исключает выбранные ветви из композиции, сохраняя файлы владельцев. */
export function selectStorybookCatalog(catalog: StorybookCatalog, excluded: readonly string[]): StorybookCatalog {
  const removed = new Set(excluded)
  let changed = true
  while (changed) {
    changed = false
    for (const scope of catalog.scopes) {
      if (!removed.has(scope.canonicalId)) continue
      const children = scope.kind === "workspace" ? scope.projectIds : scope.kind === "project" ? scope.packageIds : []
      for (const id of children) {
        if (!removed.has(id)) {
          removed.add(id)
          changed = true
        }
      }
    }
  }
  return Object.freeze({
    schemaVersion: catalog.schemaVersion,
    rootIds: Object.freeze(catalog.rootIds.filter(id => !removed.has(id))),
    scopes: Object.freeze(catalog.scopes.filter(scope => !removed.has(scope.canonicalId)).map(scope => {
      if (scope.kind === "workspace") return Object.freeze({...scope, projectIds: Object.freeze(scope.projectIds.filter(id => !removed.has(id)))})
      if (scope.kind === "project") return Object.freeze({...scope, packageIds: Object.freeze(scope.packageIds.filter(id => !removed.has(id)))})
      return scope
    })),
  })
}
