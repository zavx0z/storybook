import type {BuildCompiler} from "../contract"
import type {StorybookPackageCompilerInputs} from "../contract/models"

/** Внутреннее краткое имя публичных входов compiler setup. */
type StorybookPackageCompilerInput = BuildCompiler.Input
/**
Собирает граф физических владельцев для компиляции пакета и общей оболочки.
Объявление зависимости задаёт имя и совместимость; установленная ссылка на
исходники сохраняет локального владельца и при обычном диапазоне версий.
Ссылки внутри node_modules остаются установками менеджера пакетов и не
расширяют граф исходников. Resolver и JSX compiler используют одни границы.

@packageDocumentation
*/
import {conditionalExportTarget} from "./export-target.ts"
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs"
import {basename, dirname, isAbsolute, join, parse, relative, resolve, sep} from "node:path"
import {pathToFileURL} from "node:url"
import {
  canonicalizeStorybookPackageFile,
  preferredStorybookPackageRoot,
  readStorybookPackageOwner,
  sameStorybookPackageOwner,
} from "./owner-identity.ts"

const JSX_IMPORT_SOURCE = "@zavx0z/jsx"
const JSX_BUN_PACKAGE = "@jsx-compiler/bun"
const LOCAL_DEPENDENCY_PREFIXES = ["link:", "workspace:", "file:", "portal:"] as const
const PHYSICAL_PROBE_EXTENSIONS = /(?:\.[cm]?[jt]sx?|\.d\.ts)$/u
const physicalOwnerRootsCache = new Map<string, readonly string[]>()

type PackageManifest = Readonly<{
  declaredDependencies: ReadonlySet<string>
  root: string
  name: string
  localDependencies: ReadonlyMap<string, string>
}>

type OwnerDependencyGraph = Readonly<{
  declaredDependencies: ReadonlySet<string>
  packageRootsByName: ReadonlyMap<string, string>
  sourceRoots: readonly string[]
  styleSourceRootIds: readonly string[]
}>

/**
Возвращает канонические корни объявленных владельцев одной compiler session.
Локальный протокол либо установленная ссылка из node_modules на исходники
подключают владельца; обычный диапазон проверяется по версии его манифеста.
*/
export function resolveStorybookCompilerSourceRoots(input: Readonly<{
  repo: string
  packageRoot: string
}>): readonly string[] {
  const repo = canonicalDirectory(input.repo, "Storybook Repo root")
  const packageRoot = canonicalDirectory(input.packageRoot, "Storybook package root")
  if (!inside(repo, packageRoot)) {
    throw new Error(`Storybook package root must be inside repo root: ${packageRoot}`)
  }
  return discoverOwnerDependencyGraph(repo, packageRoot).sourceRoots
}

/**
Возвращает файловые границы реального compiler setup без создания plugin.

Чтение использует тот же consumer/tool owner graph и выбор JSX adapter,
что и `createStorybookPackageCompilerPlugins`.

@throws Если source, owner graph, tsconfig или JSX adapter export не проходят те же
проверки, что и при создании compiler plugin.
*/
export function resolveStorybookPackageCompilerInputs(
  input: StorybookPackageCompilerInput,
): StorybookPackageCompilerInputs {
  const context = resolveCompilerContext(input)
  return Object.freeze({
    sourceRoots: context.sourceRoots,
    adapterPath: context.adapterPath,
    configPaths: context.configPaths,
    semanticSourceRoots: context.compilerRoots.sourceRoots,
  })
}

/** Resolves runtime imports to the same exact owner roots governed by compilation. */
export function createStorybookOwnerResolver(input: Readonly<{
  repo: string
  packageRoot: string
}>): Bun.BunPlugin {
  const repo = canonicalDirectory(input.repo, "Storybook Repo root")
  const packageRoot = canonicalDirectory(input.packageRoot, "Storybook package root")
  if (!inside(repo, packageRoot)) {
    throw new Error(`Storybook package root must be inside repo root: ${packageRoot}`)
  }
  const graph = discoverOwnerDependencyGraph(repo, packageRoot)
  return exactOwnerResolver({
    packageRootsByName: graph.packageRootsByName,
  })
}

/** Maps an attested installed hardlink back to its one canonical owner source path. */
export function createStorybookOwnerSourcePath(input: Readonly<{
  repo: string
  packageRoot: string
}>): (path: string) => string {
  const repo = canonicalDirectory(input.repo, "Storybook Repo root")
  const packageRoot = canonicalDirectory(input.packageRoot, "Storybook package root")
  if (!inside(repo, packageRoot)) {
    throw new Error(`Storybook package root must be inside repo root: ${packageRoot}`)
  }
  const roots = discoverOwnerDependencyGraph(repo, packageRoot).packageRootsByName
  return (path: string): string => {
    const installed = readStorybookPackageOwner(path)
    if (installed === null) return path
    const ownerRoot = roots.get(installed.name)
    return ownerRoot === undefined ? path : canonicalizeStorybookPackageFile(ownerRoot, path)
  }
}

type JsxPluginFactory = (
  options: Readonly<{
    cwd: string
    persistent: false
    sourceRoots: readonly string[]
    styleSourceRootIds: readonly string[]
  }>,
) => unknown

/**
Создаёт свежие compiler plugins для одного candidate `PackageSession`.

Compiler выбирается только по owner source paths и effective `tsconfig`.
JSX получает adapter через owner dependency graph; declaration не может
внедрить plugin factory или executable callback.
*/
export async function createStorybookPackageCompilerPlugins(
  input: StorybookPackageCompilerInput,
): Promise<readonly Bun.BunPlugin[]> {
  const context = resolveCompilerContext(input)
  const resolver = exactOwnerResolver({
    packageRootsByName: context.packageRootsByName,
  })
  const namespace = await import(pathToFileURL(context.adapterPath).href) as unknown
  const factory = validateJsxPluginFactory(namespace, context.adapterPath)
  let candidate: unknown
  try {
    candidate = factory({
      cwd: context.repo,
      persistent: false,
      sourceRoots: [...context.compilerRoots.sourceRoots, ...(input.generatedSourceRoot ? [input.generatedSourceRoot] : [])],
      styleSourceRootIds: [...context.compilerRoots.styleSourceRootIds, ...(input.generatedSourceRoot ? ["storybook-scenario-jsx"] : [])],
    })
  } catch (error) {
    throw new Error(`JSX compiler factory failed: ${context.adapterPath}`, {cause: error})
  }
  const plugin = validateBunPlugin(candidate, context.adapterPath)
  return Object.freeze([resolver, plugin])
}

/** Собирает единый compiler context для plugin setup и чтения его входов. */
function resolveCompilerContext(
  input: StorybookPackageCompilerInput,
): Readonly<{
  repo: string
  packageRootsByName: ReadonlyMap<string, string>
  compilerRoots: Readonly<{sourceRoots: readonly string[]; styleSourceRootIds: readonly string[]}>
  sourceRoots: readonly string[]
  adapterPath: string
  configPaths: readonly string[]
}> {
  const repo = canonicalDirectory(input.repo, "Storybook Repo root")
  const packageRoot = canonicalDirectory(input.packageRoot, "Storybook package root")
  if (!inside(repo, packageRoot)) {
    throw new Error(`Storybook package root must be inside repo root: ${packageRoot}`)
  }
  if (!Array.isArray(input.moduleSourcePaths)) {
    throw new TypeError("Storybook compiler moduleSourcePaths must be a list")
  }
  const sourcePaths = Object.freeze([...new Set(input.moduleSourcePaths.map((path, index) =>
    canonicalSourcePath(path, index, packageRoot, repo)))].sort(comparePaths))
  const toolRoot = canonicalDirectory(input.toolRoot, "Storybook tool root")
  const toolGraph = discoverOwnerDependencyGraph(toolRoot, toolRoot)
  const hasConsumerModules = sourcePaths.length > 0
  const dependencyGraph = hasConsumerModules ? discoverOwnerDependencyGraph(repo, packageRoot) : toolGraph
  const packageRootsByName = mergeOwnerPackageRoots(
    dependencyGraph.packageRootsByName,
    toolGraph.packageRootsByName,
  )
  const effectiveConfig = hasConsumerModules
    ? effectiveJsxCompilerConfig(repo, packageRoot, sourcePaths)
    : Object.freeze({jsxImportSource: undefined, configPaths: Object.freeze([])})
  const jsxImportSource = effectiveConfig.jsxImportSource
  const compileOwnerJsx = hasConsumerModules && jsxImportSource === JSX_IMPORT_SOURCE
  const jsxRoot = compileOwnerJsx
    ? dependencyGraph.packageRootsByName.get(JSX_IMPORT_SOURCE) ?? (
      dependencyGraph.declaredDependencies.has(JSX_IMPORT_SOURCE)
        ? toolGraph.packageRootsByName.get(JSX_IMPORT_SOURCE)
        : undefined
    )
    : toolGraph.packageRootsByName.get(JSX_IMPORT_SOURCE)
  if (jsxRoot === undefined) {
    throw new Error(compileOwnerJsx
      ? `${JSX_IMPORT_SOURCE} is required by tsconfig but is not a linked owner dependency`
      : `${JSX_IMPORT_SOURCE} is required by the shared Storybook Workbench compiler`)
  }
  const adapterRoot = (compileOwnerJsx ? dependencyGraph.packageRootsByName.get(JSX_BUN_PACKAGE) : undefined)
    ?? toolGraph.packageRootsByName.get(JSX_BUN_PACKAGE)
  if (adapterRoot === undefined) {
    throw new Error(`${JSX_BUN_PACKAGE} is required by the Storybook JSX compiler`)
  }
  const compilerRoots = mergeCompilerSourceRoots(
    ...(compileOwnerJsx ? [dependencyGraph] : []),
    toolGraph,
  )
  const adapterPath = resolveJsxAdapter(packageRoot, repo, adapterRoot, toolRoot)
  return Object.freeze({
    repo,
    packageRootsByName,
    compilerRoots,
    sourceRoots: Object.freeze([...new Set([
      ...dependencyGraph.sourceRoots,
      ...toolGraph.sourceRoots,
    ])].sort(comparePaths)),
    adapterPath,
    configPaths: effectiveConfig.configPaths,
  })
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
}>): Bun.BunPlugin {
  const governedPackageFilter = exactPackageSpecifierFilter(input.packageRootsByName.keys())
  return {
    name: "external-storybook-exact-owner-resolution",
    setup(builder) {
      const target = builder.config?.target ?? (builder.config ? "browser" : "bun")
      const configured = builder.config?.conditions ?? []
      const conditions = ["import", target, ...(target === "bun" ? ["node"] : []),
        ...(typeof configured === "string" ? [configured] : configured)]
      builder.onResolve({filter: governedPackageFilter}, ({path}) => {
        const packageName = barePackageName(path)
        const ownerRoot = input.packageRootsByName.get(packageName)
        if (ownerRoot === undefined) return undefined
        return {path: resolveExactOwnerExport(ownerRoot, packageName, path, conditions)}
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
      const previous = output.get(name)
      if (previous !== undefined && previous !== root) {
        if (!sameStorybookPackageOwner(previous, root)) {
          throw new Error(`Ambiguous owner dependency identity ${name}: ${previous} and ${root}`)
        }
        output.set(name, preferredStorybookPackageRoot(previous, root))
        continue
      }
      output.set(name, root)
    }
  }
  return output
}

function barePackageName(specifier: string): string {
  const segments = specifier.split("/")
  return specifier.startsWith("@") ? `${segments[0]}/${segments[1]}` : segments[0]!
}

function resolveExactOwnerExport(
  ownerRoot: string,
  packageName: string,
  specifier: string,
  conditions: readonly string[],
): string {
  const manifest = parseJsonObject(join(ownerRoot, "package.json"), "exact owner package manifest")
  if (manifest.name !== packageName) {
    throw new Error(`Exact owner package name mismatch: expected ${packageName}, found ${String(manifest.name)}`)
  }
  const suffix = specifier.slice(packageName.length)
  const subpath = suffix === "" ? "." : `.${suffix}`
  const packageExports = manifest.exports
  let target: string | null = null
  if (subpath === "." && packageExports !== undefined &&
    (!isObject(packageExports) || !Object.keys(packageExports).some(key => key.startsWith(".")))) {
    target = conditionalExportTarget(packageExports, conditions)
  } else if (isObject(packageExports)) {
    target = conditionalExportTarget(packageExports[subpath], conditions)
  }
  if (target === null && subpath === "." && packageExports === undefined) {
    target = conditionalExportTarget(manifest.module, conditions) ?? conditionalExportTarget(manifest.main, conditions)
    if (target === null && existsSync(join(ownerRoot, "index.ts"))) target = "./index.ts"
    if (target === null && existsSync(join(ownerRoot, "index.js"))) target = "./index.js"
  }
  if (target === null) {
    throw new Error(`Cannot resolve exact owner package ${specifier} from ${ownerRoot}`)
  }
  if (!target.startsWith("./") || target.includes("*")) {
    throw new Error(`Exact owner export must be one package-relative file: ${specifier} -> ${target}`)
  }
  const path = canonicalLexicalFile(resolve(ownerRoot, target), `exact owner export ${specifier}`)
  if (!inside(ownerRoot, path)) throw new Error(`Exact owner export escaped ${packageName}: ${path}`)
  return path
}

/** Читает effective JSX owner и сохраняет каждый реально посещённый config. */
function effectiveJsxCompilerConfig(
  repo: string,
  packageRoot: string,
  sourcePaths: readonly string[],
): Readonly<{jsxImportSource: string | undefined; configPaths: readonly string[]}> {
  const configPaths = new Set<string>()
  for (const sourcePath of sourcePaths) {
    const configPath = findNearestTsconfig(dirname(sourcePath), repo)
    if (configPath !== null) configPaths.add(configPath)
  }
  if (configPaths.size === 0) {
    const packageConfig = findNearestTsconfig(packageRoot, repo)
    if (packageConfig !== null) configPaths.add(packageConfig)
  }
  if (configPaths.size === 0) {
    return Object.freeze({jsxImportSource: undefined, configPaths: Object.freeze([])})
  }

  const cache = new Map<string, string | undefined>()
  const visited = new Set<string>()
  const values = [
    ...[...configPaths]
    .sort(comparePaths)
    .map((path) => readTsconfigJsxImportSource(path, cache, new Set(), visited)),
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
  return Object.freeze({
    jsxImportSource: values[0],
    configPaths: Object.freeze([...visited].sort(comparePaths)),
  })
}

function explicitJsxImportSource(path: string): string | undefined {
  if (!/\.[cm]?[jt]sx$/u.test(path)) return undefined
  const source = readFileSync(path, "utf8").slice(0, 4_096)
  const match = source.match(/@jsxImportSource\s+([^\s*]+)/u)
  const value = match?.[1]
  return value === undefined || value.trim().length === 0 ? undefined : value.trim()
}

/** Читает native JSX protocol одного source по его pragma и effective tsconfig extends. */
export function resolveStorybookJsxImportSource(sourcePath: string): string | undefined {
  const path = canonicalFile(sourcePath, "Storybook JSX source")
  const explicit = explicitJsxImportSource(path)
  if (explicit !== undefined) return explicit
  const config = findNearestTsconfig(dirname(path), parse(path).root)
  return config === null ? undefined : readTsconfigJsxImportSource(config, new Map(), new Set(), new Set())
}

function findNearestTsconfig(start: string, repo: string): string | null {
  let directory = canonicalDirectory(start, "Storybook compiler source directory")
  while (inside(repo, directory)) {
    const candidate = join(directory, "tsconfig.json")
    if (existsSync(candidate)) return canonicalFile(candidate, "Storybook tsconfig")
    if (directory === repo) break
    directory = dirname(directory)
  }
  return null
}

function readTsconfigJsxImportSource(
  configPath: string,
  cache: Map<string, string | undefined>,
  loading: Set<string>,
  visited: Set<string>,
): string | undefined {
  const path = canonicalFile(configPath, "Storybook tsconfig")
  visited.add(path)
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
      const parentValue = readTsconfigJsxImportSource(parentPath, cache, loading, visited)
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
  repo: string,
  packageRoot: string,
): OwnerDependencyGraph {
  const queue = [
    ...(existsSync(join(repo, "package.json")) ? [repo] : []),
    ...(packageRoot === repo ? [] : [packageRoot]),
  ]
  if (queue.length === 0) {
    throw new Error(`Storybook owner package manifest is missing: ${packageRoot}`)
  }
  const manifestsByRoot = new Map<string, PackageManifest>()
  const declaredDependencies = new Set<string>()
  const packageRootsByName = new Map<string, string>()
  while (queue.length > 0) {
    const root = queue.shift()!
    if (manifestsByRoot.has(root)) continue
    const manifest = readPackageManifest(root, root === repo || root === packageRoot)
    manifestsByRoot.set(root, manifest)
    for (const name of manifest.declaredDependencies) declaredDependencies.add(name)
    registerPackageRoot(packageRootsByName, manifest.name, root)
    for (const [name, specifier] of [...manifest.localDependencies].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0)) {
      const dependencyRoot = resolveLocalDependencyRoot(name, specifier, root)
      const dependencyManifest = readPackageManifest(dependencyRoot, false)
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
    .filter((root) => !inside(repo, root))
    .sort(comparePaths)
  for (const root of externalRoots) {
    if (inside(root, repo)) {
      throw new Error(`Owner dependency root cannot contain the Storybook Repo: ${root}`)
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
  const repoSource = sourceOwners.get(repo)
  const orderedSources = [
    ...(repoSource === undefined ? [] : [[repo, repoSource] as const]),
    ...[...sourceOwners]
      .filter(([root]) => root !== repo)
      .sort(([left], [right]) => comparePaths(left, right)),
  ]
  return Object.freeze({
    declaredDependencies: Object.freeze(declaredDependencies),
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

function readPackageManifest(
  root: string,
  includeDevDependencies: boolean,
): PackageManifest {
  const manifestPath = join(root, "package.json")
  const manifest = parseJsonObject(manifestPath, "owner package manifest")
  if (typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
    throw new TypeError(`Owner package manifest has no name: ${manifestPath}`)
  }
  const dependencies = new Map<string, string>()
  const declaredDependencies = new Set<string>()
  const sectionNames = [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    ...(includeDevDependencies ? ["devDependencies" as const] : []),
  ] as const
  for (const sectionName of sectionNames) {
    const section = manifest[sectionName]
    if (section === undefined) continue
    if (!isObject(section)) {
      throw new TypeError(`Owner package manifest ${sectionName} must be an object: ${manifestPath}`)
    }
    for (const [name, value] of Object.entries(section)) {
      declaredDependencies.add(name)
      if (typeof value !== "string") {
        throw new TypeError(`Owner dependency ${name} must have a string specifier: ${manifestPath}`)
      }
      if (!isLocalDependency(value) && !isInstalledSourceDependency(name, value, root)) continue
      const previous = dependencies.get(name)
      if (previous !== undefined && previous !== value) {
        throw new Error(`Conflicting local owner dependency ${name}: ${manifestPath}`)
      }
      dependencies.set(name, value)
    }
  }
  return Object.freeze({
    declaredDependencies: Object.freeze(declaredDependencies),
    root,
    name: manifest.name,
    localDependencies: dependencies,
  })
}

/**
Распознаёт объявленную версионную зависимость, установленную ссылкой на исходники.
Ближайшая установка определяет разрешение; ссылки в node_modules менеджера
пакетов не становятся локальными владельцами. Имя и версия подтверждаются
манифестом фактической цели без загрузки кода или обращения к registry.
*/
function isInstalledSourceDependency(name: string, specifier: string, ownerRoot: string): boolean {
  let directory = ownerRoot
  while (true) {
    const candidate = join(directory, "node_modules", ...name.split("/"))
    const installed = lstatSync(candidate, {throwIfNoEntry: false})
    if (installed !== undefined) {
      if (!installed.isSymbolicLink()) return false
      const sourceRoot = canonicalDirectory(candidate, `owner dependency ${name}`)
      if (sourceRoot.split(sep).includes("node_modules")) return false
      const manifest = parseJsonObject(join(sourceRoot, "package.json"), "installed source owner manifest")
      if (manifest.name !== name) {
        throw new Error(`Resolved owner dependency identity mismatch: expected ${name}, found ${manifest.name}`)
      }
      if (typeof manifest.version !== "string" || !Bun.semver.satisfies(manifest.version, specifier)) {
        throw new Error(`Installed source owner ${name} version ${manifest.version} does not satisfy ${specifier}`)
      }
      return true
    }
    const parent = dirname(directory)
    if (parent === directory) return false
    directory = parent
  }
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

function resolveJsxAdapter(
  packageRoot: string,
  repo: string,
  adapterRoot: string,
  toolRoot: string,
): string {
  const manifest = parseJsonObject(
    join(adapterRoot, "package.json"),
    "JSX Bun owner package manifest",
  )
  const declared = conditionalExportTarget(
    isObject(manifest.exports) ? manifest.exports["."] : manifest.exports,
  )
  if (declared !== null) {
    if (!declared.startsWith("./")) {
      throw new Error(`JSX compiler export must be package-relative: ${declared}`)
    }
    const adapterPath = canonicalLexicalFile(
      resolve(adapterRoot, declared),
      "JSX compiler adapter",
    )
    if (!inside(adapterRoot, adapterPath)) {
      throw new Error(`JSX compiler adapter escaped its owner package: ${adapterPath}`)
    }
    return adapterPath
  }
  const attempts = [...new Set([
    packageRoot,
    repo,
    toolRoot,
  ])]
  for (const fromRoot of attempts) {
    let resolved: string
    try {
      resolved = Bun.resolveSync(JSX_BUN_PACKAGE, fromRoot)
    } catch {
      continue
    }
    const adapterPath = canonicalLexicalFile(resolved, "JSX compiler adapter")
    if (!inside(adapterRoot, adapterPath)) continue
    return adapterPath
  }
  throw new Error(`Cannot resolve ${JSX_BUN_PACKAGE} from owner dependency graph`)
}


function validateJsxPluginFactory(
  namespace: unknown,
  adapterPath: string,
): JsxPluginFactory {
  if (!isObject(namespace) || typeof namespace.default !== "function") {
    throw new TypeError(
      `JSX adapter must export default createJsxBunPlugin(): ${adapterPath}`,
    )
  }
  return namespace.default as JsxPluginFactory
}

function validateBunPlugin(value: unknown, adapterPath: string): Bun.BunPlugin {
  if (!isObject(value) || typeof value.name !== "string" || value.name.trim().length === 0 ||
    typeof value.setup !== "function") {
    throw new TypeError(`JSX adapter returned an invalid Bun plugin: ${adapterPath}`)
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
    if (!sameStorybookPackageOwner(previous, root)) {
      throw new Error(`Ambiguous owner dependency identity ${name}: ${previous} and ${root}`)
    }
    roots.set(name, preferredStorybookPackageRoot(previous, root))
    return
  }
  roots.set(name, root)
}

function canonicalSourcePath(
  value: string,
  index: number,
  packageRoot: string,
  repo: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Storybook compiler module source ${index} must be a path`)
  }
  // Preserve the declared owner path: native realpath may select a Bun hardlink
  // mirror in node_modules even though the exact lexical file is inside repo.
  const lexicalPath = canonicalLexicalFile(isAbsolute(value) ? value : resolve(packageRoot, value),
    `Storybook compiler module source ${index}`)
  let path = lexicalPath
  if (!inside(repo, path)) {
    try {
      path = canonicalizeStorybookPackageFile(packageRoot, path)
    } catch {
      // A foreign source still fails the Repo boundary below.
    }
  }
  if (!inside(repo, path)) {
    throw new Error(`Storybook compiler module source must be inside repo root: ${path}`)
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

export function canonicalLexicalFile(value: string, label = "Compiler source"): string {
  let parent: string
  try {
    parent = realpathSync.native(dirname(resolve(value)))
  } catch (error) {
    throw new Error(`${label} parent does not exist: ${value}`, {cause: error})
  }
  const path = join(parent, basename(value))
  let opened: ReturnType<typeof lstatSync>
  try {
    opened = lstatSync(path)
  } catch (error) {
    throw new Error(`${label} does not exist: ${path}`, {cause: error})
  }
  if (!opened.isFile() || opened.isSymbolicLink()) {
    throw new Error(`${label} must be an exact non-symlink file: ${path}`)
  }
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

function comparablePath(value: string): string {
  const path = resolve(value)
  return process.platform === "darwin" || process.platform === "win32"
    ? path.toLowerCase()
    : path
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
