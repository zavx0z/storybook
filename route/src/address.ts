import type {ParsedRoute} from "./types"

/** Разбирает входной адрес без обращения к браузеру или файловой системе. */
export function parseRoute(route: string): ParsedRoute | null {
  if (route.includes("\0") || route.includes("#")) return null

  const queryIndex = route.indexOf("?")
  const rawPathname = queryIndex === -1 ? route : route.slice(0, queryIndex)
  const rawQuery = queryIndex === -1 ? "" : route.slice(queryIndex + 1)
  const trimmedPathname = rawPathname.startsWith("/") ? rawPathname.slice(1) : rawPathname
  const withoutTrailingSlash = trimmedPathname.endsWith("/")
    ? trimmedPathname.slice(0, -1)
    : trimmedPathname

  const rawSegments = withoutTrailingSlash === "" ? [] : withoutTrailingSlash.split("/")
  const segments: string[] = []
  for (const rawSegment of rawSegments) {
    let segment: string
    try {
      segment = decodeURIComponent(rawSegment)
    } catch {
      return null
    }
    if (!isRouteSegment(segment)) return null
    segments.push(segment)
  }

  const query = new URLSearchParams(rawQuery)
  if ([...query.keys()].some(key => key !== "variant" && key !== "view")
    || query.getAll("variant").length > 1
    || query.getAll("view").length > 1) return null
  const variant = query.get("variant") ?? undefined
  if (variant !== undefined && (variant.length === 0 || variant.includes("\0"))) return null
  const requestedView = query.get("view") ?? undefined
  if (requestedView !== undefined
    && requestedView !== "overview"
    && requestedView !== "scenarios"
    && requestedView !== "contract"
    && requestedView !== "dependencies") return null
  const view = requestedView === undefined || requestedView === "overview"
    ? undefined
    : requestedView

  return {
    segments,
    ...(variant === undefined ? {} : {variant}),
    ...(view === undefined ? {} : {view}),
  }
}

/** Проверяет имя, назначенное зарегистрированному корню вызывающим кодом. */
export function isRouteRootName(name: string): boolean {
  return name.length > 0
    && name !== "."
    && name !== ".."
    && !name.startsWith(".")
    && !name.includes("/")
    && !name.includes("\\")
    && !name.includes("\0")
}

/** Проверяет декодированный сегмент внешнего маршрута. */
function isRouteSegment(segment: string): boolean {
  return segment.length > 0
    && segment !== "."
    && segment !== ".."
    && !segment.includes("/")
    && !segment.includes("\\")
    && !segment.includes("\0")
    && !/%(?:00|2f|5c)/iu.test(segment)
}
