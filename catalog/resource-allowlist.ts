import {realpathSync, statSync} from "node:fs"
import {dirname, isAbsolute, relative, resolve} from "node:path"
import {markdownDestinations} from "@webxr/markdown/destinations"

export const EXTERNAL_STORYBOOK_DOCUMENTATION_MAX_BYTES = 1_048_576

export type ExternalStorybookResourceAllowListEntry = Readonly<{
  kind: "source" | "documentation-asset"
  path: string
}>

export type ExternalStorybookResourceAllowList = Readonly<{
  ownerRoot: string
  sourcePath: string | null
  entries: readonly ExternalStorybookResourceAllowListEntry[]
  resolveSourceFile(path: string): string | null
  resolveAsset(path: string): string | null
}>

/** Проверенное описание извлечено из кода; файл не читается как Markdown. */
export type CreateExternalStorybookResourceAllowListInput = Readonly<{
  ownerRoot: string
  sourcePath: string | null
  markdown: string
  maxBytes?: number
}>

/**
Сохраняет точный исходник TSDoc и только явно связанные с ним локальные ресурсы.
Извлечение текста принадлежит читателю кода; этот список проверяет владение и
разрешает ресурсы относительно исходника. Соседние файлы сами по себе не доступны.
*/
export function createExternalStorybookResourceAllowList(
  input: CreateExternalStorybookResourceAllowListInput,
): ExternalStorybookResourceAllowList {
  const ownerRoot = canonicalDirectory(input.ownerRoot, "Storybook resource owner root")
  const sourcePath = input.sourcePath === null
    ? null
    : canonicalOwnedFile(input.sourcePath, ownerRoot, "Storybook documentation source")
  if (sourcePath !== null && resolve(input.sourcePath!) !== sourcePath) {
    throw new Error(`Storybook documentation source must not be a symlink: ${input.sourcePath}`)
  }
  const maxBytes = input.maxBytes ?? EXTERNAL_STORYBOOK_DOCUMENTATION_MAX_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`Invalid Storybook documentation byte limit: ${String(maxBytes)}`)
  }
  if (typeof input.markdown !== "string" || Buffer.byteLength(input.markdown) > maxBytes) {
    throw new Error(`Storybook documentation exceeds ${maxBytes} bytes or is not text`)
  }
  const assets = new Set<string>()
  const entries: ExternalStorybookResourceAllowListEntry[] = []
  if (sourcePath !== null) {
    if (statSync(sourcePath).size > maxBytes) {
      throw new Error(`Storybook documentation source exceeds ${maxBytes} bytes: ${sourcePath}`)
    }
    entries.push(Object.freeze({kind: "source", path: sourcePath}))
    for (const destination of localMarkdownDestinations(input.markdown)) {
      const asset = resolveLocalDocumentationAsset(sourcePath, destination, ownerRoot)
      if (asset === null || asset === sourcePath || assets.has(asset)) continue
      assets.add(asset)
      entries.push(Object.freeze({kind: "documentation-asset", path: asset}))
    }
  }
  return Object.freeze({
    ownerRoot,
    sourcePath,
    entries: Object.freeze(entries.sort((left, right) => left.path.localeCompare(right.path))),
    resolveSourceFile(path: string): string | null {
      const canonical = safeCanonicalOwnedFile(path, ownerRoot)
      return canonical !== null && canonical === sourcePath ? canonical : null
    },
    resolveAsset(path: string): string | null {
      const canonical = safeCanonicalOwnedFile(path, ownerRoot)
      return canonical !== null && assets.has(canonical) ? canonical : null
    },
  })
}

/** Получает адреса через публичную сущность Markdown и оставляет только локальные ресурсы. */
export function localMarkdownDestinations(source: string): readonly string[] {
  if (typeof source !== "string") throw new TypeError("Storybook Markdown source must be text")
  const destinations = markdownDestinations({source}).destinations.filter(localDestination)
  return Object.freeze([...new Set(destinations)])
}

function resolveLocalDocumentationAsset(sourcePath: string, destination: string, ownerRoot: string): string | null {
  const withoutFragment = destination.split("#", 1)[0]!
  if (withoutFragment.length === 0 || withoutFragment.includes("?")) return null
  let decoded: string
  try {
    decoded = withoutFragment.split("/").map((segment) => {
      const value = decodeURIComponent(segment)
      if (value.length === 0 || value === ".." || value.includes("/") ||
        value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) {
        throw new Error("unsafe Markdown asset segment")
      }
      return value
    }).join("/")
  } catch {
    return null
  }
  return safeCanonicalOwnedFile(resolve(dirname(sourcePath), decoded), ownerRoot)
}

function localDestination(value: string): boolean {
  return value.length > 0 && !value.startsWith("#") && !value.startsWith("/") &&
    !value.startsWith("//") && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) &&
    !/[\u0000-\u001f\u007f\\]/u.test(value)
}

function canonicalDirectory(path: string, label: string): string {
  const canonical = realpathSync(path)
  if (!statSync(canonical).isDirectory()) throw new Error(`${label} must be a directory: ${canonical}`)
  return canonical
}

function canonicalOwnedFile(path: string, ownerRoot: string, label: string): string {
  const canonical = realpathSync(path)
  if (!contained(ownerRoot, canonical) || !statSync(canonical).isFile()) {
    throw new Error(`${label} must be an exact file inside its owner root: ${path}`)
  }
  return canonical
}

function safeCanonicalOwnedFile(path: string, ownerRoot: string): string | null {
  try {
    return canonicalOwnedFile(path, ownerRoot, "Storybook resource")
  } catch {
    return null
  }
}

function contained(root: string, path: string): boolean {
  const local = relative(root, path)
  return local === "" || (!local.startsWith("..") && !isAbsolute(local))
}
