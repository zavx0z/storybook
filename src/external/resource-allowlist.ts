import {readFileSync, realpathSync, statSync} from "node:fs"
import {dirname, isAbsolute, relative, resolve} from "node:path"

export const EXTERNAL_STORYBOOK_README_MAX_BYTES = 1_048_576

export type ExternalStorybookResourceAllowListEntry = Readonly<{
  kind: "readme" | "declared-resource" | "readme-asset"
  path: string
}>

export type ExternalStorybookResourceAllowList = Readonly<{
  ownerRoot: string
  readmePath: string | null
  entries: readonly ExternalStorybookResourceAllowListEntry[]
  resolveReadmeFile(path: string): string | null
  resolveDeclaredResource(path: string): string | null
}>

export type CreateExternalStorybookResourceAllowListInput = Readonly<{
  ownerRoot: string
  readmePath?: string | null
  declaredResources?: readonly (string | Readonly<{path: string}>)[]
  readmeMaxBytes?: number
}>

/**
 * Creates one immutable exact-file allow-list for a declaration snapshot.
 *
 * Local README assets are derived only from literal Markdown link/image
 * destinations. An arbitrary sibling inside the owner root is never admitted.
 */
export function createExternalStorybookResourceAllowList(
  input: CreateExternalStorybookResourceAllowListInput,
): ExternalStorybookResourceAllowList {
  const ownerRoot = canonicalDirectory(input.ownerRoot, "Storybook resource owner root")
  const readmePath = input.readmePath === undefined || input.readmePath === null
    ? null
    : canonicalOwnedFile(input.readmePath, ownerRoot, "Storybook README")
  const readmeMaxBytes = input.readmeMaxBytes ?? EXTERNAL_STORYBOOK_README_MAX_BYTES
  if (!Number.isSafeInteger(readmeMaxBytes) || readmeMaxBytes <= 0) {
    throw new Error(`Invalid Storybook README byte limit: ${String(readmeMaxBytes)}`)
  }

  const readmeFiles = new Set<string>()
  const declaredResources = new Set<string>()
  const entries = new Map<string, ExternalStorybookResourceAllowListEntry>()
  const append = (kind: ExternalStorybookResourceAllowListEntry["kind"], path: string): void => {
    if (!entries.has(path)) entries.set(path, Object.freeze({kind, path}))
  }

  if (readmePath !== null) {
    readmeFiles.add(readmePath)
    append("readme", readmePath)
    const metadata = statSync(readmePath)
    if (metadata.size > readmeMaxBytes) {
      throw new Error(`Storybook README exceeds ${readmeMaxBytes} bytes: ${readmePath}`)
    }
    const source = readFileSync(readmePath, "utf8")
    for (const destination of localMarkdownDestinations(source)) {
      const asset = resolveLocalReadmeAsset(readmePath, destination, ownerRoot)
      if (asset === null) continue
      readmeFiles.add(asset)
      append("readme-asset", asset)
    }
  }

  for (const [index, value] of (input.declaredResources ?? []).entries()) {
    const source = typeof value === "string" ? value : value.path
    const path = canonicalOwnedFile(source, ownerRoot, `Storybook declared resource ${index}`)
    declaredResources.add(path)
    append("declared-resource", path)
  }

  const frozenEntries = Object.freeze([...entries.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return Object.freeze({
    ownerRoot,
    readmePath,
    entries: frozenEntries,
    resolveReadmeFile(path: string): string | null {
      const canonical = safeCanonicalOwnedFile(path, ownerRoot)
      return canonical !== null && readmeFiles.has(canonical) ? canonical : null
    },
    resolveDeclaredResource(path: string): string | null {
      const canonical = safeCanonicalOwnedFile(path, ownerRoot)
      return canonical !== null && declaredResources.has(canonical) ? canonical : null
    },
  })
}

/** Extracts the bounded inline link/image destination subset rendered by Storybook Markdown. */
export function localMarkdownDestinations(source: string): readonly string[] {
  if (typeof source !== "string") throw new TypeError("Storybook Markdown source must be text")
  const destinations = [...source.matchAll(/!?\[[^\]\n]*\]\(([^()\s]+)\)/gu)]
    .map((match) => match[1]!)
    .filter((value) => localDestination(value))
  return Object.freeze([...new Set(destinations)])
}

function resolveLocalReadmeAsset(readmePath: string, destination: string, ownerRoot: string): string | null {
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
  return safeCanonicalOwnedFile(resolve(dirname(readmePath), decoded), ownerRoot)
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
