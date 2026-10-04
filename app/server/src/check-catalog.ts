import type {StorybookAppServerCatalog} from "@storybook-app-server/catalog"

type Registry = StorybookAppServerCatalog.Output
type Snapshot = ReturnType<Registry["snapshot"]>

/** Обновляет структуру выбранных владельцев через существующие dirty paths каталога. */
export async function refreshCheckCatalog(
  scope: string | null,
  registry: Pick<Registry, "snapshot" | "markDirty">,
  refresh: (force?: boolean) => Promise<Snapshot>,
  select: (snapshot: Snapshot, scope: string | null) => readonly string[],
): Promise<Snapshot> {
  if (scope === null) return refresh(true)
  const current = registry.snapshot()
  let selected: readonly string[]
  try {
    selected = select(current, scope)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Unknown Storybook check scope:")) throw error
    // Ещё не обнаруженный пакет сначала требует чтения состава подключённых Repo.
    return refresh(true)
  }
  const ids = new Set(selected)
  const paths = current.catalog.scopes
    .filter(owner => owner.kind === "package" && ids.has(owner.id))
    .map(owner => owner.scopeRoot)
  if (paths.length === 0) return refresh(true)
  registry.markDirty(paths)
  return refresh()
}
