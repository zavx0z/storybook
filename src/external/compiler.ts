import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs"
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"

const TEMPLATE_JSX_IMPORT_SOURCE = "@zavx0z/template"
const TEMPLATE_BUN_EXPORT = "@zavx0z/template/bun"
const LOCAL_DEPENDENCY_PREFIXES = ["link:", "workspace:", "file:", "portal:"] as const
const STORYBOOK_TOOL_ROOT = fileURLToPath(new URL("../../", import.meta.url))
const PHYSICAL_PROBE_EXTENSIONS = /(?:\.[cm]?[jt]sx?|\.d\.ts)$/u
const physicalOwnerRootsCache = new Map<string, readonly string[]>()

export type StorybookPackageCompilerInput = Readonly<{
  packageRoot: string
  projectRoot: string
  moduleSourcePaths: readonly string[]
}>

type PackageManifest = Readonly<{
  root: string
  name: string
  localDependencies: ReadonlyMap<string, string>
}>

type OwnerDependencyGraph = Readonly<{
  packageRootsByName: ReadonlyMap<string, string>
  sourceRoots: readonly string[]
  styleSourceRootIds: readonly string[]
}>

/** Resolves the exact manifest-reached owner roots governed by one compiler session. */
export function resolveStorybookCompilerSourceRoots(input: Readonly<{
  projectRoot: string
  packageRoot: string
}>): readonly string[] {
  const projectRoot = canonicalDirectory(input.projectRoot, "Storybook project root")
  const packageRoot = canonicalDirectory(input.packageRoot, "Storybook package root")
  if (!inside(projectRoot, packageRoot)) {
    throw new Error(`Storybook package root must be inside project root: ${packageRoot}`)
  }
  return discoverOwnerDependencyGraph(projectRoot, packageRoot).sourceRoots
}

type TemplatePluginFactory = (
  options: Readonly<{
    cwd: string
    persistent: false
    sourceRoots: readonly string[]
    styleSourceRootIds: readonly string[]
  }>,
) => unknown

/**
Creates fresh compiler plugins for one PackageSession candidate build.

Compiler selection comes only from owner source paths and effective tsconfig
files. Template JSX resolves its existing adapter through the owner dependency
graph; declarations cannot inject plugin factories or executable callbacks.
*/
export async function createStorybookPackageCompilerPlugins(
  input: StorybookPackageCompilerInput,
): Promise<readonly Bun.BunPlugin[]> {
  const projectRoot = canonicalDirectory(input.projectRoot, "Storybook project root")
  const packageRoot = canonicalDirectory(input.packageRoot, "Storybook package root")
  if (!inside(projectRoot, packageRoot)) {
    throw new Error(`Storybook package root must be inside project root: ${packageRoot}`)
  }
  if (!Array.isArray(input.moduleSourcePaths)) {
    throw new TypeError("Storybook compiler moduleSourcePaths must be a list")
  }
  const sourcePaths = Object.freeze([...new Set(input.moduleSourcePaths.map((path, index) =>
    canonicalSourcePath(path, index, packageRoot, projectRoot)))].sort(comparePaths))
  const dependencyGraph = discoverOwnerDependencyGraph(projectRoot, packageRoot)
  const toolGraph = discoverOwnerDependencyGraph(
    canonicalDirectory(STORYBOOK_TOOL_ROOT, "Storybook tool root"),
    canonicalDirectory(STORYBOOK_TOOL_ROOT, "Storybook tool root"),
  )
  const exactOwnerRoots = mergeOwnerPackageRoots(
    dependencyGraph.packageRootsByName,
    toolGraph.packageRootsByName,
  )
  const resolver = exactOwnerResolver({
    packageRootsByName: exactOwnerRoots,
    bases: Object.freeze([packageRoot, projectRoot, canonicalDirectory(STORYBOOK_TOOL_ROOT, "Storybook tool root")]),
  })
  const jsxImportSource = effectiveJsxImportSource(projectRoot, packageRoot, sourcePaths)
  const compileOwnerTemplate = jsxImportSource === TEMPLATE_JSX_IMPORT_SOURCE
  const templateRoot = compileOwnerTemplate
    ? dependencyGraph.packageRootsByName.get(TEMPLATE_JSX_IMPORT_SOURCE)
    : toolGraph.packageRootsByName.get(TEMPLATE_JSX_IMPORT_SOURCE)
  if (templateRoot === undefined) {
    throw new Error(compileOwnerTemplate
      ? `${TEMPLATE_JSX_IMPORT_SOURCE} is required by tsconfig but is not a linked owner dependency`
      : `${TEMPLATE_JSX_IMPORT_SOURCE} is required by the shared Storybook Workbench compiler`)
  }
  const compilerRoots = mergeCompilerSourceRoots(
    ...(compileOwnerTemplate ? [dependencyGraph] : []),
    toolGraph,
  )
  const adapterPath = resolveTemplateAdapter(packageRoot, projectRoot, templateRoot)
  const namespace = await import(pathToFileURL(adapterPath).href) as unknown
  const factory = validateTemplatePluginFactory(namespace, adapterPath)
  let candidate: unknown
  try {
    candidate = factory({
      cwd: projectRoot,
      persistent: false,
      sourceRoots: compilerRoots.sourceRoots,
      styleSourceRootIds: compilerRoots.styleSourceRootIds,
    })
  } catch (error) {
    throw new Error(`Template JSX compiler factory failed: ${adapterPath}`, {cause: error})
  }
  const plugin = validateBunPlugin(candidate, adapterPath)
  return Object.freeze([resolver, plugin])
}

function mergeCompilerSourceRoots(
  ...graphs: readonly Pick<OwnerDependencyGraph, "sourceRoots" | "styleSourceRootIds">[]
): Readonly<{sourceRoots: readonly string[]; styleSourceRootIds: readonly string[]}> {
  const sourceRoots: string[] = []
  const styleSourceRootIds: string[] = []
  const physicalRoots = new Set<string>()
  for (const graph of graphs) {
    if (graph.sourceRoots.length !== graph.styleSourceRootIds.length) {
      throw new Error("Storybook compiler source roots and public ids are misaligned")
    }
    for (const [index, root] of graph.sourceRoots.entries()) {
      if (physicalRoots.has(root)) continue
      physicalRoots.add(root)
      sourceRoots.push(root)
      styleSourceRootIds.push(graph.styleSourceRootIds[index]!)
    }
  }
  return Object.freeze({
    sourceRoots: Object.freeze(sourceRoots),
    styleSourceRootIds: Object.freeze(styleSourceRootIds),
  })
}

function exactOwnerResolver(input: Readonly<{
  packageRootsByName: ReadonlyMap<string, string>
  bases: readonly string[]
}>): Bun.BunPlugin {
  const governedPackageFilter = exactPackageSpecifierFilter(input.packageRootsByName.keys())
  return {
    name: "external-storybook-exact-owner-resolution",
    setup(builder) {
      builder.onResolve({filter: governedPackageFilter}, ({path}) => {
        const packageName = barePackageName(path)
        const ownerRoot = input.packageRootsByName.get(packageName)
        if (ownerRoot === undefined) return undefined
        for (const base of input.bases) {
          let candidate: string
          try {
            candidate = Bun.resolveSync(path, base)
          } catch {
            continue
          }
          if (insideLexically(ownerRoot, candidate)) return {path: candidate}
        }
        throw new Error(`Cannot resolve exact owner package ${path} as ${ownerRoot}`)
      })
    },
  }
}

function exactPackageSpecifierFilter(packageNames: Iterable<string>): RegExp {
  const alternatives = [...packageNames]
    .sort(comparePaths)
    .map((packageName) => packageName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
  return alternatives.length === 0
    ? /^(?!)$/u
    : new RegExp(`^(?:${alternatives.join("|")})(?:/|$)`, "u")
}

function mergeOwnerPackageRoots(
  ...maps: readonly ReadonlyMap<string, string>[]
): ReadonlyMap<string, string> {
  const output = new Map<string, string>()
  for (const map of maps) {
    for (const [name, root] of map) {
      if (!output.has(name)) output.set(name, root)
    }
  }
  return output
}

function barePackageName(specifier: string): string {
  const segments = specifier.split("/")
  return specifier.startsWith("@") ? `${segments[0]}/${segments[1]}` : segments[0]!
}

function effectiveJsxImportSource(
  projectRoot: string,
  packageRoot: string,
  sourcePaths: readonly string[],
): string | undefined {
  const configPaths = new Set<string>()
  for (const sourcePath of sourcePaths) {
    const configPath = findNearestTsconfig(dirname(sourcePath), projectRoot)
    if (configPath !== null) configPaths.add(configPath)
  }
  if (configPaths.size === 0) {
    const packageConfig = findNearestTsconfig(packageRoot, projectRoot)
    if (packageConfig !== null) configPaths.add(packageConfig)
  }
  if (configPaths.size === 0) return undefined

  const cache = new Map<string, string | undefined>()
  const values = [
    ...[...configPaths]
    .sort(comparePaths)
    .map((path) => readTsconfigJsxImportSource(path, cache, new Set())),
    ...sourcePaths.flatMap((path) => {
      const value = explicitJsxImportSource(path)
      return value === undefined ? [] : [value]
    }),
  ]
  const distinct = new Set(values)
  if (distinct.size > 1) {
    throw new Error(
      `Storybook package modules have conflicting jsxImportSource values: ${
        values.map((value) => value ?? "<none>").join(", ")}`,
    )
  }
  return values[0]
}

function explicitJsxImportSource(path: string): string | undefined {
  if (!/\.[cm]?[jt]sx$/u.test(path)) return undefined
  const source = readFileSync(path, "utf8").slice(0, 4_096)
  const match = source.match(/@jsxImportSource\s+([^\s*]+)/u)
  const value = match?.[1]
  return value === undefined || value.trim().length === 0 ? undefined : value.trim()
}

function findNearestTsconfig(start: string, projectRoot: string): string | null {
  let directory = canonicalDirectory(start, "Storybook compiler source directory")
  while (inside(projectRoot, directory)) {
    const candidate = join(directory, "tsconfig.json")
    if (existsSync(candidate)) return canonicalFile(candidate, "Storybook tsconfig")
    if (directory === projectRoot) break
    directory = dirname(directory)
  }
  return null
}

function readTsconfigJsxImportSource(
  configPath: string,
  cache: Map<string, string | undefined>,
  loading: Set<string>,
): string | undefined {
  const path = canonicalFile(configPath, "Storybook tsconfig")
  if (cache.has(path)) return cache.get(path)
  if (loading.has(path)) throw new Error(`Cyclic Storybook tsconfig extends: ${path}`)
  loading.add(path)
  const config = parseJsoncObject(path, "Storybook tsconfig")
  let result: string | undefined
  const extended = config.extends
  if (extended !== undefined) {
    const specifiers = typeof extended === "string"
      ? [extended]
      : Array.isArray(extended) && extended.every((value) => typeof value === "string")
        ? extended
        : null
    if (specifiers === null) throw new TypeError(`Invalid tsconfig extends: ${path}`)
    for (const specifier of specifiers) {
      const parentPath = resolveExtendedTsconfig(specifier, dirname(path))
      const parentValue = readTsconfigJsxImportSource(parentPath, cache, loading)
      if (parentValue !== undefined) result = parentValue
    }
  }
  const compilerOptions = config.compilerOptions
  if (compilerOptions !== undefined) {
    if (!isObject(compilerOptions)) {
      throw new TypeError(`Storybook tsconfig compilerOptions must be an object: ${path}`)
    }
    if (Object.hasOwn(compilerOptions, "jsxImportSource")) {
      const value = compilerOptions.jsxImportSource
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new TypeError(`Invalid jsxImportSource in Storybook tsconfig: ${path}`)
      }
      result = value
    }
  }
  loading.delete(path)
  cache.set(path, result)
  return result
}

function resolveExtendedTsconfig(specifier: string, fromDirectory: string): string {
  if (specifier.length === 0) throw new Error("Storybook tsconfig extends cannot be empty")
  const candidates: string[] = []
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    const base = resolve(fromDirectory, specifier)
    candidates.push(base, `${base}.json`, join(base, "tsconfig.json"))
  } else {
    for (const request of [specifier, `${specifier}/tsconfig.json`]) {
      try {
        candidates.push(Bun.resolveSync(request, fromDirectory))
      } catch {
        // Try the next exact package export form.
      }
    }
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return canonicalFile(candidate, "extended Storybook tsconfig")
    }
  }
  throw new Error(`Cannot resolve Storybook tsconfig extends ${JSON.stringify(specifier)} from ${fromDirectory}`)
}

function discoverOwnerDependencyGraph(
  projectRoot: string,
  packageRoot: string,
): OwnerDependencyGraph {
  const queue = [
    ...(existsSync(join(projectRoot, "package.json")) ? [projectRoot] : []),
    ...(packageRoot === projectRoot ? [] : [packageRoot]),
  ]
  if (queue.length === 0) {
    throw new Error(`Storybook owner package manifest is missing: ${packageRoot}`)
  }
  const manifestsByRoot = new Map<string, PackageManifest>()
  const packageRootsByName = new Map<string, string>()
  while (queue.length > 0) {
    const root = queue.shift()!
    if (manifestsByRoot.has(root)) continue
    const manifest = readPackageManifest(root)
    manifestsByRoot.set(root, manifest)
    registerPackageRoot(packageRootsByName, manifest.name, root)
    for (const [name, specifier] of [...manifest.localDependencies].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0)) {
      const dependencyRoot = resolveLocalDependencyRoot(name, specifier, root)
      const dependencyManifest = readPackageManifest(dependencyRoot)
      if (dependencyManifest.name !== name) {
        throw new Error(
          `Resolved owner dependency identity mismatch: expected ${name}, found ${dependencyManifest.name}`,
        )
      }
      registerPackageRoot(packageRootsByName, name, dependencyRoot)
      if (!manifestsByRoot.has(dependencyRoot)) queue.push(dependencyRoot)
    }
  }

  const externalRoots = [...new Set(packageRootsByName.values())]
    .filter((root) => !inside(projectRoot, root))
    .sort(comparePaths)
  for (const root of externalRoots) {
    if (inside(root, projectRoot)) {
      throw new Error(`Owner dependency root cannot contain the Storybook project: ${root}`)
    }
  }
  const sourceOwners = new Map<string, string>()
  for (const [name, root] of packageRootsByName) {
    for (const physicalRoot of physicalOwnerRoots(root)) {
      const previous = sourceOwners.get(physicalRoot)
      if (previous !== undefined && previous !== name) {
        throw new Error(`Ambiguous public source root identity ${physicalRoot}: ${previous} and ${name}`)
      }
      sourceOwners.set(physicalRoot, name)
    }
  }
  const projectSource = sourceOwners.get(projectRoot)
  const orderedSources = [
    ...(projectSource === undefined ? [] : [[projectRoot, projectSource] as const]),
    ...[...sourceOwners]
      .filter(([root]) => root !== projectRoot)
      .sort(([left], [right]) => comparePaths(left, right)),
  ]
  return Object.freeze({
    packageRootsByName,
    sourceRoots: Object.freeze(orderedSources.map(([root]) => root)),
    styleSourceRootIds: Object.freeze(orderedSources.map(([, id]) => id)),
  })
}

function physicalOwnerRoots(root: string): readonly string[] {
  const cached = physicalOwnerRootsCache.get(root)
  if (cached !== undefined) return cached
  const manifestPath = join(root, "package.json")
  if (!existsSync(manifestPath)) {
    const result = Object.freeze([root])
    physicalOwnerRootsCache.set(root, result)
    return result
  }
  const declaredManifest = parseJsonObject(manifestPath, "owner package manifest")
  const targets = [
    manifestPath,
    ...packageEntrypointTargets(root, declaredManifest),
    ...packagePhysicalProbeFiles(root),
  ]
  const roots = new Set<string>([root])
  for (const target of targets) {
    const relativeTarget = relative(root, target)
    const physicalTarget = realpathSync.native(target)
    let physicalRoot = physicalTarget
    for (const _segment of relativeTarget.split(sep).filter(Boolean)) physicalRoot = dirname(physicalRoot)
    if (physicalRoot === root || roots.has(physicalRoot)) continue
    const projectedTarget = resolve(physicalRoot, relativeTarget)
    const physicalManifest = join(physicalRoot, "package.json")
    if (!existsSync(projectedTarget) || !existsSync(physicalManifest)) continue
    const declared = statSync(target)
    const physical = statSync(projectedTarget)
    if (declared.dev !== physical.dev || declared.ino !== physical.ino) {
      throw new Error(`Owner package physical identity mismatch: ${target}`)
    }
    const manifest = parseJsonObject(physicalManifest, "physical owner package manifest")
    if (manifest.name !== declaredManifest.name) {
      throw new Error(`Owner package physical name mismatch: ${physicalRoot}`)
    }
    roots.add(physicalRoot)
  }
  const result = Object.freeze([...roots])
  physicalOwnerRootsCache.set(root, result)
  return result
}

function packagePhysicalProbeFiles(root: string): readonly string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      if (entry.isSymbolicLink() || entry.name === "node_modules" || entry.name === ".git") continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && PHYSICAL_PROBE_EXTENSIONS.test(entry.name)) files.push(path)
    }
  }
  visit(root)
  return Object.freeze(files)
}

function packageEntrypointTargets(root: string, manifest: Record<string, unknown>): readonly string[] {
  const values: string[] = []
  for (const field of [manifest.main, manifest.module, manifest.types]) collectPackageTargets(field, values)
  collectPackageTargets(manifest.exports, values)
  return Object.freeze([...new Set(values.flatMap((value) => {
    if (!value.startsWith("./") || value.includes("*")) return []
    const path = resolve(root, value)
    return existsSync(path) ? [path] : []
  }))])
}

function collectPackageTargets(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    output.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectPackageTargets(entry, output)
    return
  }
  if (!isObject(value)) return
  for (const entry of Object.values(value)) collectPackageTargets(entry, output)
}

function readPackageManifest(root: string): PackageManifest {
  const manifestPath = join(root, "package.json")
  const manifest = parseJsonObject(manifestPath, "owner package manifest")
  if (typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
    throw new TypeError(`Owner package manifest has no name: ${manifestPath}`)
  }
  const dependencies = new Map<string, string>()
  for (const sectionName of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    "devDependencies",
  ] as const) {
    const section = manifest[sectionName]
    if (section === undefined) continue
    if (!isObject(section)) {
      throw new TypeError(`Owner package manifest ${sectionName} must be an object: ${manifestPath}`)
    }
    for (const [name, value] of Object.entries(section)) {
      if (typeof value !== "string") {
        throw new TypeError(`Owner dependency ${name} must have a string specifier: ${manifestPath}`)
      }
      if (!isLocalDependency(value)) continue
      const previous = dependencies.get(name)
      if (previous !== undefined && previous !== value) {
        throw new Error(`Conflicting local owner dependency ${name}: ${manifestPath}`)
      }
      dependencies.set(name, value)
    }
  }
  return Object.freeze({
    root,
    name: manifest.name,
    localDependencies: dependencies,
  })
}

function resolveLocalDependencyRoot(
  name: string,
  specifier: string,
  ownerRoot: string,
): string {
  const separator = specifier.indexOf(":")
  const protocol = specifier.slice(0, separator + 1)
  const target = specifier.slice(separator + 1)
  if ((protocol === "file:" || protocol === "portal:" || protocol === "link:") &&
    (target.startsWith(".") || isAbsolute(target))) {
    return canonicalDirectory(resolve(ownerRoot, target), `owner dependency ${name}`)
  }

  const packageSegments = name.split("/")
  let directory = ownerRoot
  while (true) {
    const candidate = join(directory, "node_modules", ...packageSegments)
    if (existsSync(candidate)) {
      return canonicalDirectory(candidate, `owner dependency ${name}`)
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }

  for (const request of [`${name}/package.json`, name]) {
    try {
      const entry = Bun.resolveSync(request, ownerRoot)
      const root = findResolvedPackageRoot(entry, name)
      if (root !== null) return root
    } catch {
      // Both exact resolution forms must fail before reporting the dependency.
    }
  }
  throw new Error(`Cannot resolve linked owner dependency ${name} from ${ownerRoot}`)
}

function findResolvedPackageRoot(entry: string, expectedName: string): string | null {
  let directory = statSync(entry).isDirectory() ? entry : dirname(entry)
  while (true) {
    const manifestPath = join(directory, "package.json")
    if (existsSync(manifestPath)) {
      const manifest = parseJsonObject(manifestPath, "resolved owner package manifest")
      if (manifest.name === expectedName) return canonicalDirectory(directory, `owner dependency ${expectedName}`)
    }
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

function resolveTemplateAdapter(
  packageRoot: string,
  projectRoot: string,
  templateRoot: string,
): string {
  const attempts = [...new Set([
    packageRoot,
    projectRoot,
    canonicalDirectory(STORYBOOK_TOOL_ROOT, "Storybook tool root"),
  ])]
  for (const fromRoot of attempts) {
    let resolved: string
    try {
      resolved = Bun.resolveSync(TEMPLATE_BUN_EXPORT, fromRoot)
    } catch {
      continue
    }
    const adapterPath = canonicalFile(resolved, "Template JSX compiler adapter")
    if (!inside(templateRoot, adapterPath)) continue
    return adapterPath
  }
  throw new Error(`Cannot resolve ${TEMPLATE_BUN_EXPORT} from owner dependency graph`)
}

function validateTemplatePluginFactory(
  namespace: unknown,
  adapterPath: string,
): TemplatePluginFactory {
  if (!isObject(namespace) || typeof namespace.createTemplateJsxBunPlugin !== "function") {
    throw new TypeError(
      `Template JSX adapter must export createTemplateJsxBunPlugin(): ${adapterPath}`,
    )
  }
  return namespace.createTemplateJsxBunPlugin as TemplatePluginFactory
}

function validateBunPlugin(value: unknown, adapterPath: string): Bun.BunPlugin {
  if (!isObject(value) || typeof value.name !== "string" || value.name.trim().length === 0 ||
    typeof value.setup !== "function") {
    throw new TypeError(`Template JSX adapter returned an invalid Bun plugin: ${adapterPath}`)
  }
  return value as unknown as Bun.BunPlugin
}

function registerPackageRoot(
  roots: Map<string, string>,
  name: string,
  root: string,
): void {
  const previous = roots.get(name)
  if (previous !== undefined && previous !== root) {
    throw new Error(`Ambiguous owner dependency identity ${name}: ${previous} and ${root}`)
  }
  roots.set(name, root)
}

function canonicalSourcePath(
  value: string,
  index: number,
  packageRoot: string,
  projectRoot: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Storybook compiler module source ${index} must be a path`)
  }
  const path = canonicalFile(isAbsolute(value) ? value : resolve(packageRoot, value),
    `Storybook compiler module source ${index}`)
  if (!inside(projectRoot, path)) {
    throw new Error(`Storybook compiler module source must be inside project root: ${path}`)
  }
  return path
}

function canonicalDirectory(value: string, label: string): string {
  let path: string
  try {
    path = realpathSync.native(resolve(value))
  } catch (error) {
    throw new Error(`${label} does not exist: ${value}`, {cause: error})
  }
  if (!statSync(path).isDirectory()) throw new Error(`${label} must be a directory: ${path}`)
  return path
}

function canonicalFile(value: string, label: string): string {
  let path: string
  try {
    path = realpathSync.native(resolve(value))
  } catch (error) {
    throw new Error(`${label} does not exist: ${value}`, {cause: error})
  }
  if (!statSync(path).isFile()) throw new Error(`${label} must be a file: ${path}`)
  return path
}

function parseJsonObject(path: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${path}`, {cause: error})
  }
  if (!isObject(value)) throw new TypeError(`${label} must be an object: ${path}`)
  return value
}

function parseJsoncObject(path: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = Bun.JSONC.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${path}`, {cause: error})
  }
  if (!isObject(value)) throw new TypeError(`${label} must be an object: ${path}`)
  return value
}

function isLocalDependency(value: string): boolean {
  return LOCAL_DEPENDENCY_PREFIXES.some((prefix) => value.startsWith(prefix))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function inside(root: string, path: string): boolean {
  const child = relative(comparablePath(root), comparablePath(path))
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !child.startsWith(sep))
}

function insideLexically(root: string, path: string): boolean {
  const child = relative(resolve(root), resolve(path))
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !child.startsWith(sep))
}

function comparablePath(value: string): string {
  const path = resolve(value)
  return process.platform === "darwin" || process.platform === "win32"
    ? path.toLowerCase()
    : path
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
