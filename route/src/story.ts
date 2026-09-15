import {readFile} from "node:fs/promises"
import {dirname} from "node:path"
import {readContainedFile} from "./files"

/**
Физический владелец одной точно совпавшей authored story.

@property route - Точный authored route presentation внутри пакета.

@property directory - Реальная директория пакета для overview либо файла
`module.path` для варианта.
*/
interface AuthoredStory {
  readonly route: string
  readonly directory: string
}

/**
Найденный уровень authored catalog route до разрешения module path.

@property kind - Overview категории/предмета либо executable variant.

@property [module] - Декларация модуля варианта до проверки пути.
*/
interface AuthoredMatch {
  readonly kind: "overview" | "variant"
  readonly module?: Record<string, unknown>
}

/**
Ищет один exact category, subject или variant route в актуальном package-owned
каталоге. Чтение ограничено manifest, указанным им catalog и файлом найденного
variant module.

@param rootPath - Реальный зарегистрированный корень.
@param packagePath - Реальный корень ближайшего пакета.
@param route - Запрошенный remainder внутри ближайшего пакета.
@returns Физический владелец exact authored presentation либо `null`.
*/
export async function readAuthoredStory(
  rootPath: string,
  packagePath: string,
  route: string,
): Promise<AuthoredStory | null> {
  const manifestPath = await readContainedFile(
    rootPath,
    packagePath,
    packagePath,
    ".storybook/manifest.json",
  )
  if (manifestPath === null) return null
  const manifest = await readJsonRecord(manifestPath)
  if (manifest === null
    || manifest.schemaVersion !== 1
    || (manifest.kind !== undefined && manifest.kind !== "package")
    || typeof manifest.catalog !== "string"
    || manifest.catalog.length === 0) return null

  const catalogPath = await readContainedFile(
    rootPath,
    packagePath,
    dirname(manifestPath),
    manifest.catalog,
  )
  if (catalogPath === null) return null
  const catalog = await readJsonRecord(catalogPath)
  if (catalog === null || catalog.schemaVersion !== 1 || !Array.isArray(catalog.categories)) return null

  const matches: AuthoredMatch[] = []
  for (const category of catalog.categories) {
    if (!isRecord(category)) continue
    const categoryRoute = readDeclaredRoute(category)
    if (categoryRoute === null) continue
    if (categoryRoute === route) matches.push({kind: "overview"})
    const subjects = Array.isArray(category.subjects) ? category.subjects : []
    for (const subject of subjects) {
      if (!isRecord(subject)) continue
      const subjectRoute = readDeclaredRoute(subject, categoryRoute)
      if (subjectRoute === null) continue
      if (subjectRoute === route) matches.push({kind: "overview"})
      const variants = Array.isArray(subject.variants) ? subject.variants : []
      for (const variant of variants) {
        if (!isRecord(variant)) continue
        const variantRoute = readDeclaredRoute(variant, subjectRoute)
        if (variantRoute === route) {
          matches.push({
            kind: "variant",
            ...(isRecord(variant.module) ? {module: variant.module} : {}),
          })
        }
      }
    }
  }
  if (matches.length !== 1) return null

  const match = matches[0]
  if (match?.kind === "overview") return {route, directory: packagePath}
  const module = match?.module
  if (module === undefined) return null
  if (!isRecord(module)
    || typeof module.path !== "string"
    || module.path.length === 0
    || typeof module.export !== "string"
    || module.export.length === 0) return null
  const modulePath = await readContainedFile(
    rootPath,
    packagePath,
    dirname(catalogPath),
    module.path,
  )
  return modulePath === null ? null : {route, directory: dirname(modulePath)}
}

/**
Читает exact authored route либо применяет schema-default из `id` относительно
родительского route.
*/
function readDeclaredRoute(record: Record<string, unknown>, parentRoute?: string): string | null {
  if (typeof record.route === "string" && record.route.length > 0) return record.route
  if (record.route !== undefined || typeof record.id !== "string" || record.id.length === 0) return null
  return parentRoute === undefined ? record.id : `${parentRoute}/${record.id}`
}

/** Читает JSON object, не интерпретируя декларацию как исполняемый код. */
async function readJsonRecord(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"))
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

/** Отличает JSON object от массива и примитива. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
