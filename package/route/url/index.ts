/** Публичные пути пакетов и query-параметры Storybook без браузерного lifecycle.

@packageDocumentation
*/
import type {StorybookPackageRouteUrl} from "./contract"

export type {StorybookPackageRouteUrl} from "./contract"

/**
Проверяет параметры адреса подтверждённой страницы пакета.

@param url - Разобранный адрес; origin и путь проверяются вызывающим владельцем.

@returns Допустимы только уникальные preview, inspector, view и variant. Выбор доступной секции
проверяет runtime; параметр не меняет принадлежность страницы пакету.
*/
function validStorybookViewQuery(url: URL): boolean {
  const seen = new Set<string>()
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) return false
    seen.add(key)
    if (key === "preview") {
      if (!/^[A-Za-z0-9_-]{1,256}$/u.test(value)) return false
    } else if (key === "view") {
      if (!["overview", "scenarios", "contract", "dependencies"].includes(value)) return false
    } else if (key === "inspector" || key === "variant") {
      if (value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) return false
    } else return false
  }
  return true
}

/**
Строит публичный сегмент URL без изменения идентификатора самого пакета.

@param packageId - Имя пакета, при наличии области имён — в форме `@scope/name`.
Допускаются строчные латинские буквы, цифры и предусмотренные проверкой разделители.

@returns Имя без начального `@`, с заменой `/` между областью и именем на `-`.

@throws Ошибка при недопустимом идентификаторе пакета.
*/
function storybookPackagePathSegment(packageId: string): string {
  if (typeof packageId !== "string" || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageId)) {
    throw new Error(`Invalid Storybook package identity: ${packageId}`)
  }
  return packageId.replace(/^@/u, "").replace("/", "-")
}

/**
Сопоставляет сегмент URL с известным пакетом, принимая читаемую форму
и ранее опубликованную форму с кодированием идентификатора.
*/
function storybookPackagePathMatches(segment: string, packageId: string): boolean {
  return segment === storybookPackagePathSegment(packageId) || segment === encodeURIComponent(packageId)
}

/**
Строит публичный путь страницы отдельно от внутреннего ключа навигации.

@param packageId - Точный идентификатор пакета.

@param route - Маршрут внутри пакета; пустая строка обозначает его начало.
Структурные сегменты `dir-` сохраняются, остальные сегменты кодируются для URL.

@throws Ошибка при недопустимом имени пакета или структурном маршруте.
*/
function storybookPackageUrlPath(packageId: string, route = ""): string {
  const base = `/pkg-${storybookPackagePathSegment(packageId)}/`
  if (route.startsWith("dir-")) {
    const parts = route.split("/")
    const directories = ["dependencies", "contract", "scenarios"].includes(parts.at(-1) ?? "") ? parts.slice(0, -1) : parts
    if (directories.some(part => !part.startsWith("dir-") || part.length === 4)) throw new Error("Invalid structural directory route")
    return `${base}${route}`
  }
  return `${base}${route.split("/").map(encodeURIComponent).join("/")}`
}

/**
Извлекает маршрут известного пакета из пути страницы, включая прежние адреса.

@param pathname - Путь URL без строки запроса.

@param packageId - Идентификатор пакета, которому должен принадлежать адрес.

@returns Маршрут внутри пакета либо `null` при несовпадении адреса
или недопустимых сегментах.
*/
function storybookPackageRouteFromPathname(pathname: string, packageId: string): string | null {
  const segments = pathname.split("/")
  const legacy = segments[1] === "packages"
  const offset = legacy ? 2 : 1
  const segment = segments[offset]
  if (segments[0] !== "" || segment === undefined ||
    !(legacy ? storybookPackagePathMatches(segment, packageId) : segment === `pkg-${storybookPackagePathSegment(packageId)}`)) return null
  const parts = segments.slice(offset + 1)
  const trailingSlash = parts.at(-1) === ""
  if (trailingSlash) parts.pop()
  if (parts.some(part => part.length === 0)) return null
  try {
    const decoded = parts.map(part => {
      const value = decodeURIComponent(part)
      if (encodeURIComponent(value) !== part || value === "." || value === ".." || value.includes("/") || value.includes("\\")) throw new Error("Invalid route segment")
      return value
    })
    if (!legacy && parts[0]?.startsWith("dir-")) {
      const directories = ["dependencies", "contract", "scenarios"].includes(parts.at(-1) ?? "") ? parts.slice(0, -1) : parts
      if (directories.some(part => !part.startsWith("dir-") || part.length === 4)) return null
      return parts.join("/")
    }
    return decoded.join("/")
  } catch {
    return null
  }
}

/**
Преобразует ранее опубликованный ключ директории на границе адаптера.
Префикс `~directories/` заменяется структурными сегментами `dir-`;
остальные маршруты сохраняются без изменения.
*/
function storybookCurrentRouteKey(route: string): string {
  return route.startsWith("~directories/")
    ? route.slice("~directories/".length).split("/").map(segment => `dir-${segment}`).join("/")
    : route
}

/** Одна browser-safe возможность адресов пакета и проверки view query. */
const url: StorybookPackageRouteUrl.Output = Object.freeze({
  storybookPackagePathSegment,
  storybookPackagePathMatches,
  storybookPackageUrlPath,
  storybookPackageRouteFromPathname,
  storybookCurrentRouteKey,
  validViewQuery: validStorybookViewQuery,
})

export default url
