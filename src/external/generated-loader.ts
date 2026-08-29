import {isAbsolute, normalize} from "node:path"
import {
  validateExternalStorybookExportName,
  validateExternalStorybookPackageId,
  validateExternalStorybookRoute,
} from "./declaration-law.ts"

export type StorybookGeneratedModule = Readonly<{
  path: string
  export: string
}>

export type StorybookGeneratedVariant = Readonly<{
  route: string
  module: StorybookGeneratedModule
}>

export type StorybookGeneratedLoaderInput = Readonly<{
  revisionUrl: string
  runtime: StorybookGeneratedModule
  variants: readonly StorybookGeneratedVariant[]
}>

/**
Generates one build-time module containing only literal canonical filesystem
imports that were validated before source emission. Bun resolves these imports
and rewrites them to immutable revision-scoped browser chunks.

The private route map prevents a declaration value from becoming an arbitrary
browser import. A successful later candidate is published below a different
immutable `revisionUrl`, so its rewritten chunks can be retried without reusing
the rejected browser module URL from an older revision.
*/
export function generateStorybookLoaderSource(
  input: StorybookGeneratedLoaderInput,
): string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Storybook generated loader input must be an object")
  }
  if (!Array.isArray(input.variants)) {
    throw new TypeError("Storybook generated loader variants must be a list")
  }
  const revisionUrl = validateRevisionUrl(input.revisionUrl)
  const runtime = validateModule(input.runtime, "runtime")
  const routes = new Set<string>()
  const variants = input.variants.map((variant, index) => {
    if (variant === null || typeof variant !== "object" || Array.isArray(variant)) {
      throw new TypeError(`Storybook variant ${index} must be an object`)
    }
    const route = validateExternalStorybookRoute(variant.route, `Storybook variant ${index} route`)
    if (routes.has(route)) throw new Error(`Duplicate Storybook variant route: ${route}`)
    routes.add(route)
    return Object.freeze({
      route,
      module: validateModule(variant.module, `variant ${route}`),
    })
  }).sort((left, right) => left.route < right.route ? -1 : left.route > right.route ? 1 : 0)

  const routeEntries = variants.map(({route, module}) => [
    `  [${jsString(route)}, () =>`,
    `    import(${jsString(module.url)}).then((namespace) => namespace[${jsString(module.export)}])],`,
  ].join("\n")).join("\n")
  const routeValues = variants.map(({route}) => `  ${jsString(route)},`).join("\n")

  return [
    `const runtimeLoader = () =>`,
    `  import(${jsString(runtime.url)}).then((namespace) => namespace[${jsString(runtime.export)}])`,
    ``,
    `export const STORYBOOK_PACKAGE_STORY_LOADERS = new Map([`,
    routeEntries,
    `])`,
    ``,
    `export const storybookRevisionUrl = ${jsString(revisionUrl)}`,
    `export const storybookVariantRoutes = Object.freeze([`,
    routeValues,
    `])`,
    ``,
    `export function loadStorybookPackageRuntime() {`,
    `  return runtimeLoader()`,
    `}`,
    ``,
    `export function loadStorybookVariant(route) {`,
    `  const loader = STORYBOOK_PACKAGE_STORY_LOADERS.get(route)`,
    `  if (loader === undefined) {`,
    `    throw new Error("Unknown Storybook variant route: " + String(route))`,
    `  }`,
    `  return loader()`,
    `}`,
    ``,
  ].join("\n")
}

function validateModule(
  value: StorybookGeneratedModule,
  label: string,
): Readonly<{url: string; export: string}> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Storybook ${label} module must be an object`)
  }
  const path = validateModulePath(value.path, label)
  const exportName = validateExternalStorybookExportName(value.export, `Storybook ${label} export`)
  return Object.freeze({
    url: path,
    export: exportName,
  })
}

function validateRevisionUrl(value: string): string {
  if (typeof value !== "string" || value.length < 3 ||
    !value.startsWith("/") || !value.endsWith("/") ||
    value.includes("\\") || value.includes("?") || value.includes("#") ||
    value.includes("//") || hasControlCharacter(value)) {
    throw new Error(`Invalid Storybook revision URL: ${String(value)}`)
  }
  let parsed: URL
  try {
    parsed = new URL(value, "https://storybook.invalid")
  } catch (error) {
    throw new Error(`Invalid Storybook revision URL: ${value}`, {cause: error})
  }
  if (parsed.origin !== "https://storybook.invalid" || parsed.pathname !== value ||
    parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error(`Invalid Storybook revision URL: ${value}`)
  }
  const segments = value.slice(1, -1).split("/")
  if (segments.length !== 4 || segments[0] !== "__storybook" || segments[1] !== "revisions" ||
    !validEncodedPackageSegment(segments[2]!) ||
    segments[3]!.length === 0 || unsafeDecodedSegment(segments[3]!)) {
    throw new Error(`Invalid Storybook revision URL: ${value}`)
  }
  return value
}

function validEncodedPackageSegment(value: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return false
  }
  if (encodeURIComponent(decoded) !== value) return false
  try {
    validateExternalStorybookPackageId(decoded, "Storybook revision package")
    return true
  } catch {
    return false
  }
}

function validateModulePath(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value) ||
    value.endsWith("/") || value.includes("\\") || value.includes("?") ||
    value.includes("#") || value.includes("//") || hasControlCharacter(value)) {
    throw new Error(`Invalid Storybook ${label} module path: ${String(value)}`)
  }
  const normalized = normalize(value)
  const segments = normalized.split("/").slice(1)
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`Invalid Storybook ${label} module path: ${value}`)
  }
  if (normalized !== value) throw new Error(`Storybook ${label} module path is not canonical: ${value}`)
  return normalized
}

function unsafeDecodedSegment(value: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return true
  }
  return decoded === "." || decoded === ".." ||
    decoded.includes("/") || decoded.includes("\\") || hasControlCharacter(decoded)
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value)
}

function jsString(value: string): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")
}
