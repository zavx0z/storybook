import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs"
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path"
import {pathToFileURL} from "node:url"

const TEMPLATE_JSX_IMPORT_SOURCE = "@zavx0z/template"
const TEMPLATE_BUN_EXPORT = "@zavx0z/template/bun"
const LOCAL_DEPENDENCY_PREFIXES = ["link:", "workspace:", "file:", "portal:"] as const

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
}>

type TemplatePluginFactory = (
  options: Readonly<{
    cwd: string
    persistent: false
    sourceRoots: readonly string[]
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
  const jsxImportSource = effectiveJsxImportSource(projectRoot, packageRoot, sourcePaths)
  if (jsxImportSource !== TEMPLATE_JSX_IMPORT_SOURCE) return Object.freeze([])

  const dependencyGraph = discoverOwnerDependencyGraph(projectRoot, packageRoot)
  const templateRoot = dependencyGraph.packageRootsByName.get(TEMPLATE_JSX_IMPORT_SOURCE)
  if (templateRoot === undefined) {
    throw new Error(
      `${TEMPLATE_JSX_IMPORT_SOURCE} is required by tsconfig but is not a linked owner dependency`,
    )
  }
  const adapterPath = resolveTemplateAdapter(packageRoot, projectRoot, templateRoot)
  const namespace = await import(pathToFileURL(adapterPath).href) as unknown
  const factory = validateTemplatePluginFactory(namespace, adapterPath)
  let candidate: unknown
  try {
    candidate = factory({
      cwd: projectRoot,
      persistent: false,
      sourceRoots: dependencyGraph.sourceRoots,
    })
  } catch (error) {
    throw new Error(`Template JSX compiler factory failed: ${adapterPath}`, {cause: error})
  }
  const plugin = validateBunPlugin(candidate, adapterPath)
  return Object.freeze([plugin])
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
  const packageConfig = findNearestTsconfig(packageRoot, projectRoot)
  if (packageConfig !== null) configPaths.add(packageConfig)
  if (configPaths.size === 0) return undefined

  const cache = new Map<string, string | undefined>()
  const values = [...configPaths]
    .sort(comparePaths)
    .map((path) => readTsconfigJsxImportSource(path, cache, new Set()))
  const distinct = new Set(values)
  if (distinct.size > 1) {
    throw new Error(
      `Storybook package modules have conflicting jsxImportSource values: ${
        values.map((value) => value ?? "<none>").join(", ")}`,
    )
  }
  return values[0]
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
  const queue = [projectRoot, ...(packageRoot === projectRoot ? [] : [packageRoot])]
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
  return Object.freeze({
    packageRootsByName,
    sourceRoots: Object.freeze([projectRoot, ...externalRoots]),
  })
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
  const attempts = [...new Set([packageRoot, projectRoot])]
  for (const fromRoot of attempts) {
    let resolved: string
    try {
      resolved = Bun.resolveSync(TEMPLATE_BUN_EXPORT, fromRoot)
    } catch {
      continue
    }
    const adapterPath = canonicalFile(resolved, "Template JSX compiler adapter")
    if (!inside(templateRoot, adapterPath)) {
      throw new Error(
        `Template JSX compiler resolved outside the owner dependency identity: ${adapterPath}`,
      )
    }
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

function comparablePath(value: string): string {
  const path = resolve(value)
  return process.platform === "darwin" || process.platform === "win32"
    ? path.toLowerCase()
    : path
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
