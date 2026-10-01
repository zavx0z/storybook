/** Сохраняет Inspector уже аттестованного peer, если caller не выбрал секцию явно. */
export function preserveStorybookInspector(requested: string, current: string): string {
  const destination = new URL(requested)
  const selection = new URL(current).searchParams.get("inspector")
  if (!destination.searchParams.has("inspector") && selection !== null) destination.searchParams.set("inspector", selection)
  return destination.href
}

/** Сравнивает допустимые адреса без зависимости от порядка query-параметров. */
export function sameStorybookViewUrl(left: string, right: string): boolean {
  const a = new URL(left)
  const b = new URL(right)
  return a.origin === b.origin && a.pathname === b.pathname && a.hash === b.hash &&
    a.searchParams.get("preview") === b.searchParams.get("preview") &&
    a.searchParams.get("inspector") === b.searchParams.get("inspector") &&
    a.searchParams.get("variant") === b.searchParams.get("variant") &&
    (a.searchParams.get("view") ?? "overview") === (b.searchParams.get("view") ?? "overview")
}
