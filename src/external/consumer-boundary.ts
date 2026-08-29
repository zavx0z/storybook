import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs"
import {basename, dirname, extname, join, relative, resolve, sep} from "node:path"
import {
  externalStorybookRoutes,
  type ExternalStorybookGraph,
  type ExternalStorybookRoute,
} from "./graph.ts"

const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".git", "dist"])
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"])
const STORYBOOK_PACKAGE = /^@[a-z0-9][a-z0-9._-]*\/storybook$/u
const PACKAGE_ID = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u

export type StorybookConsumerBoundaryViolationKind =
  | "storybook-package"
  | "storybook-dependency"
  | "storybook-import"
  | "storybook-wrapper"
  | "storybook-lifecycle"
  | "production-story-export"

export type StorybookConsumerBoundaryViolation = Readonly<{
  root: string
  path: string
  kind: StorybookConsumerBoundaryViolationKind
  detail: string
}>

export type StorybookRouteBaseline = Readonly<{
  packageId: string
  leaves: readonly string[]
  overviews: readonly string[]
  unknownRoutesFailClosed: true
  overviewFallback: false
}>

export type StorybookRouteRemap = Readonly<{
  kind: "package"
  fromPackageId: string
  toPackageId: string
  reason: string
}> | Readonly<{
  kind: "route"
  fromPackageId: string
  fromPath: string
  toPackageId: string
  toPath: string
  reason: string
}>

export type StorybookMappedRoute = Readonly<{
  packageId: string
  path: string
}>

export type StorybookRouteBaselineComparison = Readonly<{
  ok: boolean
  expectedLeaves: readonly StorybookMappedRoute[]
  actualLeaves: readonly StorybookMappedRoute[]
  missingLeaves: readonly StorybookMappedRoute[]
  unexpectedLeaves: readonly StorybookMappedRoute[]
  leafOrderMatches: boolean
  expectedOverviews: readonly StorybookMappedRoute[]
  actualOverviews: readonly StorybookMappedRoute[]
  missingOverviews: readonly StorybookMappedRoute[]
  unexpectedOverviews: readonly StorybookMappedRoute[]
  overviewOrderMatches: boolean
  unknownRoutesFailClosed: true
  overviewFallback: false
}>

/**
Scans only the explicitly connected roots supplied by the caller.

The walk never follows directory symlinks and excludes dependency, Git and
generated output directories. Invalid manifests and unsafe broad roots reject
the verification instead of being treated as clean.
*/
export function scanStorybookConsumerBoundaries(
  connectedRoots: readonly string[],
): readonly StorybookConsumerBoundaryViolation[] {
  if (!Array.isArray(connectedRoots) || connectedRoots.length === 0) {
    throw new Error("Storybook consumer boundary requires explicit connected roots")
  }
  const roots = [...new Set(connectedRoots.map((root, index) =>
    validateConnectedRoot(root, index)))].sort(compareText)
  const violations: StorybookConsumerBoundaryViolation[] = []
  for (const root of roots) scanConnectedRoot(root, violations)
  violations.sort((left, right) =>
    compareText(left.root, right.root) ||
    compareText(left.path, right.path) ||
    compareText(left.kind, right.kind) ||
    compareText(left.detail, right.detail))
  return Object.freeze(violations)
}

/** Compares an ordered legacy route fixture with routes derived from one graph. */
export function compareRouteBaseline(
  baseline: StorybookRouteBaseline,
  graph: ExternalStorybookGraph,
  remaps: readonly StorybookRouteRemap[] = Object.freeze([]),
): StorybookRouteBaselineComparison {
  validateBaselineInvariants(baseline)
  if (!Array.isArray(remaps)) throw new TypeError("Storybook route remaps must be a list")
  const mapping = validateRouteRemaps(remaps)
  const graphRoutes = externalStorybookRoutes(graph)
  const graphPackageIds = new Set(graph.nodes
    .filter(({kind}) => kind === "package")
    .map(({packageId}) => packageId!))

  const expectedLeaves = mapBaselineRoutes(baseline.packageId, baseline.leaves, mapping)
  const expectedOverviews = mapBaselineRoutes(baseline.packageId, baseline.overviews, mapping)
  const targetPackageIds = new Set([
    ...expectedLeaves.map(({packageId}) => packageId),
    ...expectedOverviews.map(({packageId}) => packageId),
  ])
  for (const packageId of targetPackageIds) {
    if (!graphPackageIds.has(packageId)) {
      throw new Error(`Unknown Storybook route-remap target package: ${packageId}`)
    }
  }
  const actualLeaves = mappedGraphRoutes(graphRoutes, targetPackageIds, "variant")
  const actualOverviews = mappedGraphRoutes(graphRoutes, targetPackageIds, "overview")
  const missingLeaves = subtractRoutes(expectedLeaves, actualLeaves)
  const unexpectedLeaves = subtractRoutes(actualLeaves, expectedLeaves)
  const missingOverviews = subtractRoutes(expectedOverviews, actualOverviews)
  const unexpectedOverviews = subtractRoutes(actualOverviews, expectedOverviews)
  const leafOrderMatches = sameRoutes(expectedLeaves, actualLeaves)
  const overviewOrderMatches = sameRoutes(expectedOverviews, actualOverviews)
  return Object.freeze({
    ok: missingLeaves.length === 0 && unexpectedLeaves.length === 0 &&
      missingOverviews.length === 0 && unexpectedOverviews.length === 0 &&
      leafOrderMatches && overviewOrderMatches,
    expectedLeaves,
    actualLeaves,
    missingLeaves,
    unexpectedLeaves,
    leafOrderMatches,
    expectedOverviews,
    actualOverviews,
    missingOverviews,
    unexpectedOverviews,
    overviewOrderMatches,
    unknownRoutesFailClosed: true,
    overviewFallback: false,
  })
}

function scanConnectedRoot(
  root: string,
  violations: StorybookConsumerBoundaryViolation[],
): void {
  const files = listBoundaryFiles(root)
  for (const path of files) {
    const localPath = portableRelative(root, path)
    if (basename(path) === "package.json") {
      scanPackageManifest(root, localPath, path, violations)
      continue
    }
    if (isPackageLocalStorybookWrapper(localPath)) {
      violations.push(violation(
        root,
        localPath,
        "storybook-wrapper",
        `package-local Storybook lifecycle wrapper ${basename(localPath)}`,
      ))
    }
    if (!SOURCE_EXTENSIONS.has(extname(path))) continue
    scanSourceImports(root, localPath, path, violations)
  }
}

function listBoundaryFiles(root: string): readonly string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, {withFileTypes: true})
      .sort((left, right) => compareText(left.name, right.name))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name) && !forbiddenBoundarySegment(entry.name)) visit(path)
        continue
      }
      const localPath = portableRelative(root, path)
      if (entry.isFile() && (entry.name === "package.json" ||
        SOURCE_EXTENSIONS.has(extname(entry.name)) || isPackageLocalStorybookWrapper(localPath))) {
        files.push(path)
      }
    }
  }
  visit(root)
  return Object.freeze(files)
}

function scanPackageManifest(
  root: string,
  localPath: string,
  path: string,
  violations: StorybookConsumerBoundaryViolation[],
): void {
  const manifest = readJsonObject(path, "Storybook consumer package manifest")
  const name = manifest.name
  if (typeof name === "string" && STORYBOOK_PACKAGE.test(name)) {
    violations.push(violation(root, localPath, "storybook-package", `private package identity ${name}`))
  }
  for (const sectionName of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const section = manifest[sectionName]
    if (section === undefined) continue
    if (!isObject(section)) throw new TypeError(`${sectionName} must be an object: ${path}`)
    const specifier = section["@zavx0z/storybook"]
    if (specifier === undefined) continue
    if (typeof specifier !== "string") {
      throw new TypeError(`@zavx0z/storybook dependency must be a string: ${path}`)
    }
    violations.push(violation(
      root,
      localPath,
      "storybook-dependency",
      `${sectionName} @zavx0z/storybook ${specifier}`,
    ))
  }
  const scripts = manifest.scripts
  if (scripts !== undefined) {
    if (!isObject(scripts)) throw new TypeError(`scripts must be an object: ${path}`)
    for (const [key, value] of Object.entries(scripts).sort(([left], [right]) => compareText(left, right))) {
      if (typeof value !== "string") throw new TypeError(`package script ${key} must be text: ${path}`)
      if (isStorybookLifecycleScript(key, value)) {
        violations.push(violation(
          root,
          localPath,
          "storybook-lifecycle",
          `package script ${key}: ${value}`,
        ))
      }
    }
  }
  for (const exposure of storyExportExposures(manifest.exports)) {
    violations.push(violation(root, localPath, "production-story-export", exposure))
  }
}

function scanSourceImports(
  root: string,
  localPath: string,
  path: string,
  violations: StorybookConsumerBoundaryViolation[],
): void {
  const source = readFileSync(path, "utf8")
  const imports = new Set<string>()
  const transpiler = new Bun.Transpiler({loader: sourceLoader(extname(path))})
  let scanned: ReturnType<Bun.Transpiler["scanImports"]>
  try {
    scanned = transpiler.scanImports(source)
  } catch {
    scanned = []
  }
  for (const entry of scanned) {
    if (entry.path === "@zavx0z/storybook" || entry.path.startsWith("@zavx0z/storybook/")) imports.add(entry.path)
  }
  for (const typeDeclaration of [
    /^[\t ]*(?:import|export)[\t ]+type[\t ]+[^\r\n]*?\bfrom[\t ]*["'](@zavx0z\/storybook(?:\/[^"']+)?)["']/gmu,
    /^[\t ]*(?:import|export)[\t ]*\{[\s\S]*?\}[\t\r\n]*from[\t\r\n]*["'](@zavx0z\/storybook(?:\/[^"']+)?)["']/gmu,
  ]) {
    for (const match of source.matchAll(typeDeclaration)) {
      if (match.index !== undefined && codePosition(source, match.index)) imports.add(match[1]!)
    }
  }
  for (const pattern of [
    /^[\t ]*(?:import|export)(?:[\t ]+type)?(?:[\t ]+|\r?\n)(?:\{[\s\S]*?\}|\*[^\r\n]*|[^;\r\n]*?)[\t\r\n]+from[\t\r\n]*["'](@zavx0z\/storybook(?:\/[^"']+)?)["']/gmu,
    /^[\t ]*import[\t ]*["'](@zavx0z\/storybook(?:\/[^"']+)?)["']/gmu,
    /\b(?:import|require)[\t\r\n]*\([\t\r\n]*["'](@zavx0z\/storybook(?:\/[^"']+)?)["'][\t\r\n]*\)/gmu,
  ]) {
    for (const match of source.matchAll(pattern)) {
      if (match.index !== undefined && codePosition(source, match.index)) imports.add(match[1]!)
    }
  }
  for (const specifier of [...imports].sort(compareText)) {
    violations.push(violation(root, localPath, "storybook-import", `imports ${specifier}`))
  }
}

function isPackageLocalStorybookWrapper(localPath: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(localPath)) return false
  const parts = localPath.split("/")
  const file = parts.at(-1) ?? ""
  const inStorybookBoundary = parts.slice(0, -1).some((part) =>
    part === "storybook" || part === ".storybook")
  const inLifecycleScripts = parts.slice(0, -1).some((part) => part === "scripts" || part === "bin")
  const lifecycleFile = /^(?:(?:storybook)[-_.])?(?:server|build|bootstrap|launcher|serve|start|stop|restart)(?:[-_.]storybook)?\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|sh|bash|zsh)$/u
    .test(file)
  const namedStorybookLauncher = /^storybook(?:[-_.][a-z0-9._-]+)?\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|sh|bash|zsh)$/u
    .test(file)
  return (lifecycleFile && (inStorybookBoundary || file.includes("storybook"))) ||
    (namedStorybookLauncher && inLifecycleScripts)
}

function isStorybookLifecycleScript(key: string, value: string): boolean {
  if (/(?:^|:)storybook(?::|$)/u.test(key)) return true
  return /(?:^|[\s"'])(?:\.\/)?(?:[^\s"']*\/)?(?:\.storybook|storybook)\/(?:[^\s"']*\/)*(?:server|build|bootstrap|launcher|serve|start|stop|restart)\.[cm]?[jt]sx?(?:$|[\s"'])/u
    .test(value)
}

function storyExportExposures(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([])
  const exposures: string[] = []
  const visit = (candidate: unknown, publicPath: string): void => {
    if (typeof candidate === "string") {
      if (storyPath(publicPath) || storyPath(candidate)) {
        exposures.push(`production export ${publicPath} -> ${candidate}`)
      }
      return
    }
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry, publicPath)
      return
    }
    if (!isObject(candidate)) throw new TypeError("package exports must contain strings, arrays or objects")
    for (const [key, entry] of Object.entries(candidate).sort(([left], [right]) => compareText(left, right))) {
      visit(entry, key.startsWith(".") ? key : publicPath)
    }
  }
  visit(value, ".")
  return Object.freeze([...new Set(exposures)].sort(compareText))
}

function storyPath(value: string): boolean {
  return /(?:^|[./_-])(?:story|stories|storybook)(?:[./_-]|$)/iu.test(value)
}

function validateConnectedRoot(value: string, index: number): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Storybook connected root ${index} must be a path`)
  }
  let root: string
  try {
    root = realpathSync.native(resolve(value))
  } catch (error) {
    throw new Error(`Storybook connected root does not exist: ${value}`, {cause: error})
  }
  if (!statSync(root).isDirectory() || dirname(root) === root) {
    throw new Error(`Storybook connected root must be a bounded directory: ${root}`)
  }
  const segments = root.split(sep).map((segment) => segment.toLocaleLowerCase("en-US"))
  if (segments.some(forbiddenBoundarySegment)) {
    throw new Error(`Storybook connected root is an excluded production/archive boundary: ${root}`)
  }
  if (!existsSync(join(root, "package.json"))) {
    throw new Error(`Storybook connected root must own package.json: ${root}`)
  }
  return root
}

function validateBaselineInvariants(baseline: StorybookRouteBaseline): void {
  if (baseline === null || typeof baseline !== "object") {
    throw new TypeError("Storybook route baseline must be an object")
  }
  validatePackageId(baseline.packageId, "baseline package")
  if (!Array.isArray(baseline.leaves) || !Array.isArray(baseline.overviews)) {
    throw new TypeError("Storybook route baseline leaves and overviews must be lists")
  }
  if (baseline.unknownRoutesFailClosed !== true || baseline.overviewFallback !== false) {
    throw new Error("Storybook route baseline must require unknown fail-closed and no overview fallback")
  }
  const leaves = baseline.leaves.map((path) => normalizeRoutePath(path, "baseline leaf"))
  const overviews = baseline.overviews.map((path) => normalizeRoutePath(path, "baseline overview"))
  if (new Set(leaves).size !== leaves.length || new Set(overviews).size !== overviews.length) {
    throw new Error("Storybook route baseline must not contain duplicate routes")
  }
  if (leaves.some((path) => overviews.includes(path))) {
    throw new Error("Storybook route baseline cannot classify one route as leaf and overview")
  }
}

function validateRouteRemaps(remaps: readonly StorybookRouteRemap[]): Readonly<{
  packageRemaps: ReadonlyMap<string, string>
  routeRemaps: ReadonlyMap<string, StorybookMappedRoute>
}> {
  const packageRemaps = new Map<string, string>()
  const routeRemaps = new Map<string, StorybookMappedRoute>()
  for (const [index, remap] of remaps.entries()) {
    if (remap === null || typeof remap !== "object") {
      throw new TypeError(`Storybook route remap ${index} must be an object`)
    }
    if (typeof remap.reason !== "string" || remap.reason.trim().length === 0) {
      throw new Error(`Storybook route remap ${index} must document its reason`)
    }
    const fromPackageId = validatePackageId(remap.fromPackageId, `route remap ${index} source package`)
    const toPackageId = validatePackageId(remap.toPackageId, `route remap ${index} target package`)
    if (remap.kind === "package") {
      if (packageRemaps.has(fromPackageId)) {
        throw new Error(`Duplicate Storybook package remap: ${fromPackageId}`)
      }
      packageRemaps.set(fromPackageId, toPackageId)
      continue
    }
    if (remap.kind !== "route") {
      throw new Error(
        `Unknown Storybook route remap kind: ${String((remap as {kind: unknown}).kind)}`,
      )
    }
    const fromPath = normalizeRoutePath(remap.fromPath, `route remap ${index} source path`)
    const toPath = normalizeRoutePath(remap.toPath, `route remap ${index} target path`)
    const key = routeKey({packageId: fromPackageId, path: fromPath})
    if (routeRemaps.has(key)) throw new Error(`Duplicate Storybook route remap: ${fromPackageId}:${fromPath}`)
    routeRemaps.set(key, Object.freeze({packageId: toPackageId, path: toPath}))
  }
  return Object.freeze({packageRemaps, routeRemaps})
}

function mapBaselineRoutes(
  packageId: string,
  paths: readonly string[],
  mapping: Readonly<{
    packageRemaps: ReadonlyMap<string, string>
    routeRemaps: ReadonlyMap<string, StorybookMappedRoute>
  }>,
): readonly StorybookMappedRoute[] {
  return Object.freeze(paths.map((value) => {
    const path = normalizeRoutePath(value, "baseline route")
    const exact = mapping.routeRemaps.get(routeKey({packageId, path}))
    if (exact !== undefined) return exact
    return Object.freeze({
      packageId: mapping.packageRemaps.get(packageId) ?? packageId,
      path,
    })
  }))
}

function mappedGraphRoutes(
  routes: readonly ExternalStorybookRoute[],
  packageIds: ReadonlySet<string>,
  kind: ExternalStorybookRoute["kind"],
): readonly StorybookMappedRoute[] {
  return Object.freeze(routes
    .filter((route) => route.kind === kind && packageIds.has(route.packageId))
    .map(({packageId, path}) => Object.freeze({packageId, path})))
}

function subtractRoutes(
  left: readonly StorybookMappedRoute[],
  right: readonly StorybookMappedRoute[],
): readonly StorybookMappedRoute[] {
  const rightKeys = new Set(right.map(routeKey))
  return Object.freeze(left.filter((route) => !rightKeys.has(routeKey(route))))
}

function sameRoutes(
  left: readonly StorybookMappedRoute[],
  right: readonly StorybookMappedRoute[],
): boolean {
  return left.length === right.length && left.every((route, index) => routeKey(route) === routeKey(right[index]!))
}

function normalizeRoutePath(value: string, label: string): string {
  if (typeof value !== "string" || value.startsWith("/") || value.endsWith("/") ||
    value.includes("//") || value.includes("\\") || /[?#]/u.test(value) ||
    value.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Malformed Storybook ${label}: ${String(value)}`)
  }
  return value
}

function validatePackageId(value: string, label: string): string {
  if (typeof value !== "string" || !PACKAGE_ID.test(value)) {
    throw new Error(`Invalid Storybook ${label}: ${String(value)}`)
  }
  return value
}

function routeKey(route: StorybookMappedRoute): string {
  return `${route.packageId}\0${route.path}`
}

function violation(
  root: string,
  path: string,
  kind: StorybookConsumerBoundaryViolationKind,
  detail: string,
): StorybookConsumerBoundaryViolation {
  return Object.freeze({root, path, kind, detail})
}

function portableRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/")
}

function readJsonObject(path: string, label: string): Record<string, unknown> {
  const source = readFileSync(path, "utf8")
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    const templated = source.replace(/\{\{[A-Za-z0-9_]+\}\}/gu, '""')
    if (templated === source) throw new Error(`Cannot read ${label}: ${path}`, {cause: error})
    try {
      value = JSON.parse(templated)
    } catch (templateError) {
      throw new AggregateError([error, templateError], `Cannot read ${label}: ${path}`)
    }
  }
  if (!isObject(value)) throw new TypeError(`${label} must be an object: ${path}`)
  return value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function forbiddenBoundarySegment(value: string): boolean {
  const segment = value.toLocaleLowerCase("en-US")
  return /^(?:production|archive|archives|archived)(?:$|[-_.0-9])/u.test(segment)
}

function sourceLoader(extension: string): "ts" | "tsx" | "js" | "jsx" {
  if (extension === ".tsx") return "tsx"
  if (extension === ".jsx") return "jsx"
  if (extension.endsWith("js")) return "js"
  return "ts"
}

function codePosition(source: string, target: number): boolean {
  let mode: "code" | "line" | "block" | "single" | "double" | "template" = "code"
  let escaped = false
  for (let index = 0; index < target; index += 1) {
    const character = source[index]!
    const next = source[index + 1]
    if (mode === "line") {
      if (character === "\n") mode = "code"
      continue
    }
    if (mode === "block") {
      if (character === "*" && next === "/") {
        mode = "code"
        index += 1
      }
      continue
    }
    if (mode !== "code") {
      if (escaped) {
        escaped = false
        continue
      }
      if (character === "\\") {
        escaped = true
        continue
      }
      if ((mode === "single" && character === "'") ||
        (mode === "double" && character === '"') ||
        (mode === "template" && character === "`")) mode = "code"
      continue
    }
    if (character === "/" && next === "/") {
      mode = "line"
      index += 1
    } else if (character === "/" && next === "*") {
      mode = "block"
      index += 1
    } else if (character === "'") mode = "single"
    else if (character === '"') mode = "double"
    else if (character === "`") mode = "template"
  }
  return mode === "code"
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
