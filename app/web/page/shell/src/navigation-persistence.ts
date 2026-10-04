import type {StorybookAppWebPageShellWorkbenchCatalog} from "@zavx0z/storybook-app-web-page-shell-workbench-catalog"
type NavigationExpansion = NonNullable<StorybookAppWebPageShellWorkbenchCatalog.Input["navigationExpansion"]>

const STORAGE_KEY = "storybook.navigation-tree.v1"
const MAX_IDS = 4096

/** Недоступное или повреждённое хранилище не препятствует навигации. */
export function createNavigationExpansion(storage: () => Pick<Storage, "getItem" | "setItem">): NavigationExpansion {
  let initialCollapsedIds: readonly string[] | undefined
  try {
    const value = JSON.parse(storage().getItem(STORAGE_KEY) ?? "null")
    if (value?.version === 1 && Array.isArray(value.collapsedIds)) {
      initialCollapsedIds = normalizedIds(value.collapsedIds)
    }
  } catch {}
  return {
    initialCollapsedIds,
    save(ids) {
      try {
        storage().setItem(STORAGE_KEY, JSON.stringify({version: 1, collapsedIds: normalizedIds(ids)}))
      } catch {}
    },
  }
}

/** Сохраняет только ограниченные устойчивые ключи без дублей. */
function normalizedIds(value: readonly unknown[]): readonly string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 1024 || seen.has(candidate)) continue
    seen.add(candidate)
    ids.push(candidate)
    if (ids.length === MAX_IDS) break
  }
  return Object.freeze(ids)
}
