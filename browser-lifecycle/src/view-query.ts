/**
Проверяет параметры адреса подтверждённой страницы пакета.

@param url - Разобранный адрес; origin и путь проверяются вызывающим владельцем.

@returns Допустимы только уникальные preview и inspector. Выбор доступной секции
проверяет runtime; параметр не меняет принадлежность страницы пакету.
*/
export function validStorybookViewQuery(url: URL): boolean {
  const seen = new Set<string>()
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) return false
    seen.add(key)
    if (key === "preview") {
      if (!/^[A-Za-z0-9_-]{1,256}$/u.test(value)) return false
    } else if (key === "inspector") {
      if (value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) return false
    } else return false
  }
  return true
}

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
    a.searchParams.get("inspector") === b.searchParams.get("inspector")
}
