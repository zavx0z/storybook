/**
Читает готовую общую browser-среду владельца Immersive и проверяет
неизменяемую identity до её участия в разрешении модулей.

@packageDocumentation
*/
import {buildPlatform, validatePlatformArtifacts} from "./src/build"
import {runPlatformBuild} from "./src/builder"
import Compiler from "@zavx0z/storybook-tech-build-compiler"
import Protocol from "@zavx0z/storybook-tech-build-environment-protocol"
import {createHash} from "node:crypto"
import {readFileSync, realpathSync, statSync} from "node:fs"
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path"
import type {StorybookTechBuildEnvironment} from "./contract"
import type {
  StorybookSharedBrowserIdentity,
  StorybookSharedBrowserModule,
  StorybookSharedBrowserModuleEntry,
  StorybookSharedBrowserSource,
} from "./contract/types"
import {
  canonicalExactFile,
  canonicalDirectory,
} from "./src/paths"

const {readStorybookPackageOwner} = Compiler

export type {StorybookTechBuildEnvironment} from "./contract"

/** Владельцы платформы, чьи browser-значения сохраняют одну identity в realm страницы. */
const STORYBOOK_SHARED_BROWSER_OWNER_PACKAGES = Object.freeze(["@zavx0z/immersive"] as const)

/** Читает готовые browser-входы публичной поставки без компиляции исходников. */
function createStorybookSharedBrowserModuleEntries(
  toolRoot: string,
): readonly StorybookSharedBrowserModuleEntry[] {
  const entries: StorybookSharedBrowserModuleEntry[] = []
  for (const packageName of STORYBOOK_SHARED_BROWSER_OWNER_PACKAGES) {
    const packageRoot = realpathSync(join(toolRoot, "node_modules", ...packageName.split("/")))
    const manifestPath = join(packageRoot, "package.json")
    const manifest = parseObject(readFileSync(manifestPath, "utf8"), manifestPath)
    if (manifest.name !== packageName) {
      throw new Error(`Shared Storybook owner mismatch: expected ${packageName}, found ${String(manifest.name)}`)
    }
    for (const [subpath, target] of publicModuleExports(manifest.exports, packageName)) {
      const specifier = `${packageName}${subpath === "." ? "" : subpath.slice(1)}`
      const sourcePath = canonicalOwnerTarget(packageRoot, target, specifier)
      entries.push(Object.freeze({specifier, sourcePath, entryPath: sourcePath}))
    }
  }
  return Object.freeze(entries.sort((left, right) => left.specifier.localeCompare(right.specifier)))
}

/**
Проверяет сериализованную shared identity до её участия в Bun resolution.
Проверка таблицы модулей и URL не читает текущие исходники. Платформа
сохраняет собственный состав и epoch после переименования или удаления исходников;
целостность immutable файлов дополнительно проверяет читатель receipt.
*/
function validateStorybookSharedBrowserIdentity(
  value: StorybookSharedBrowserIdentity,
): StorybookSharedBrowserIdentity {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    value.protocol !== Protocol) {
    throw new TypeError("Invalid shared Storybook browser identity")
  }
  const packageEntryUrl = validateSharedUrl(value.packageEntryUrl, "package entry")
  if (typeof value.epoch !== "string" || !/^[a-f0-9]{64}$/u.test(value.epoch)) {
    throw new Error(`Invalid shared Storybook browser epoch: ${String(value.epoch)}`)
  }
  if (typeof value.hostModuleEpoch !== "string" || !/^[a-f0-9]{64}$/u.test(value.hostModuleEpoch)) {
    throw new Error(`Invalid shared Storybook host module epoch: ${String(value.hostModuleEpoch)}`)
  }
  if (!Array.isArray(value.modules)) throw new TypeError("Shared Storybook browser modules must be a list")
  const specifiers = new Set<string>()
  const urls = new Set<string>()
  const modules = value.modules.map((module, index): StorybookSharedBrowserModule => {
    if (module === null || typeof module !== "object" || Array.isArray(module)) {
      throw new TypeError(`Shared Storybook browser module ${index} must be an object`)
    }
    if (!isBareModuleSpecifier(module.specifier)) {
      throw new Error(`Unknown shared Storybook browser module: ${String(module.specifier)}`)
    }
    if (specifiers.has(module.specifier)) throw new Error(`Duplicate shared Storybook module: ${module.specifier}`)
    const url = validateSharedUrl(module.url, `module ${module.specifier}`)
    if (urls.has(url)) throw new Error(`Duplicate shared Storybook module URL: ${url}`)
    if (typeof module.sourcePath !== "string" || !module.sourcePath.startsWith("/")) {
      throw new Error(`Invalid shared Storybook module source: ${String(module.sourcePath)}`)
    }
    specifiers.add(module.specifier)
    urls.add(url)
    const sources = module.sources === undefined ? undefined : validateSources(module.sources, module.specifier)
    return Object.freeze({specifier: module.specifier, sourcePath: resolve(module.sourcePath), url,
      ...(sources === undefined ? {} : {sources}),
    })
  })
  const expectedEpoch = createHash("sha256").update(JSON.stringify({
    modules: modules.map(moduleProjection),
  })).digest("hex")
  if (value.epoch !== expectedEpoch) throw new Error("Shared Storybook module map does not match its epoch")
  return Object.freeze({
    protocol: Protocol,
    epoch: value.epoch,
    hostModuleEpoch: value.hostModuleEpoch,
    packageEntryUrl,
    modules: Object.freeze(modules),
  })
}

/** Сохраняет governed imports как browser imports общих immutable entrypoints. */
function createStorybookSharedBrowserExternalPlugin(
  identity: StorybookSharedBrowserIdentity,
  options: Readonly<{moduleSourcePaths?: readonly string[]}> = {},
): Bun.BunPlugin {
  const validated = validateStorybookSharedBrowserIdentity(identity)
  const urls = new Map(validated.modules.map(({specifier, url}) => [specifier, url]))
  const sourceBindings = new Map<string, StorybookSharedBrowserSource>()
  const sourcesByPath = new Map<string, StorybookSharedBrowserSource>()
  for (const module of validated.modules) {
    for (const source of module.sources ?? []) {
      const previous = sourceBindings.get(source.specifier)
      if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(source)) {
        throw new Error(`Ambiguous shared Storybook source binding: ${source.specifier}`)
      }
      sourceBindings.set(source.specifier, source)
      sourcesByPath.set(source.sourcePath, source)
    }
  }
  const requested = new Set((options.moduleSourcePaths ?? []).map(path => fileIdentity(canonicalExactFile(path))))
  return {
    name: "external-storybook-shared-browser-identity",
    setup(builder) {
      builder.onResolve({filter: /^[^./]/u}, ({path}) => {
        const url = urls.get(path)
        if (url !== undefined) return {path: url, external: true}
        if (isGovernedSpecifier(path)) throw new Error(`Shared Storybook browser identity has no module ${path}`)
        return undefined
      })
      builder.onResolve({filter: /^\/__storybook\/shared\//u}, ({path}) => ({path, external: true}))
      if (sourceBindings.size > 0) builder.onResolve({filter: /.*/u}, ({path, importer, resolveDir}) => {
        const bySpecifier = sourceBindings.get(path)
        if (bySpecifier === undefined && !path.startsWith(".") && !isAbsolute(path)) return undefined
        const directory = resolveDir || (importer ? dirname(importer) : process.cwd())
        let resolved: string
        try { resolved = canonicalExactFile(Bun.resolveSync(path, directory)) }
        catch (error) {
          if (bySpecifier !== undefined) throw new Error(`Cannot resolve shared Storybook source ${path}`, {cause: error})
          return undefined
        }
        if (requested.has(fileIdentity(resolved))) return undefined
        const binding = bySpecifier ?? sourcesByPath.get(resolved)
        if (binding === undefined) return undefined
        attestSource(binding, resolved)
        return {path: binding.url, external: true}
      })
    },
  }
}

function storybookSharedBrowserIdentity(
  packageEntryUrl: string,
  modules: readonly StorybookSharedBrowserModule[],
  hostModuleEpoch: string,
): StorybookSharedBrowserIdentity {
  const epoch = createHash("sha256").update(JSON.stringify({
    modules: modules.map(moduleProjection),
  })).digest("hex")
  return validateStorybookSharedBrowserIdentity({
    protocol: Protocol,
    epoch,
    hostModuleEpoch,
    packageEntryUrl,
    modules,
  })
}

/** Источники входят в epoch как metadata; наличие текущих файлов проверяется только при linkage. */
function moduleProjection(module: StorybookSharedBrowserModule): unknown {
  return {specifier: module.specifier, url: module.url,
    ...(module.sources === undefined ? {} : {sources: validateSources(module.sources, module.specifier)}),
  }
}

function validateSources(value: readonly StorybookSharedBrowserSource[], module: string): readonly StorybookSharedBrowserSource[] {
  if (!Array.isArray(value)) throw new TypeError(`Shared Storybook sources must be a list: ${module}`)
  const seen = new Set<string>()
  return Object.freeze(value.map((source, index) => {
    if (source === null || typeof source !== "object" || Array.isArray(source) || !isBareModuleSpecifier(source.specifier)) {
      throw new TypeError(`Invalid shared Storybook source ${index}: ${module}`)
    }
    if (typeof source.sourcePath !== "string" || !isAbsolute(source.sourcePath) ||
      typeof source.manifestPath !== "string" || !isAbsolute(source.manifestPath) ||
      !source.manifestPath.endsWith(`${sep}package.json`)) {
      throw new Error(`Invalid shared Storybook source paths: ${source.specifier}`)
    }
    const sourcePath = resolve(source.sourcePath)
    const manifestPath = resolve(source.manifestPath)
    const tail = relative(dirname(manifestPath), sourcePath)
    if (tail === "" || tail === ".." || tail.startsWith(`..${sep}`) || isAbsolute(tail)) {
      throw new Error(`Shared Storybook source escaped its owner: ${source.specifier}`)
    }
    if (typeof source.manifestDigest !== "string" || !/^[a-f0-9]{64}$/u.test(source.manifestDigest)) {
      throw new Error(`Invalid shared Storybook source manifest digest: ${source.specifier}`)
    }
    const key = `${source.specifier}:${sourcePath}`
    if (seen.has(key)) throw new Error(`Duplicate shared Storybook source: ${source.specifier}`)
    seen.add(key)
    return Object.freeze({specifier: source.specifier, sourcePath, manifestPath,
      manifestDigest: source.manifestDigest, url: validateSharedUrl(source.url, `source ${source.specifier}`),
    })
  }))
}

/** Подтверждает actual package и exact source, не присваивая одноимённый сторонний owner. */
function attestSource(binding: StorybookSharedBrowserSource, resolved: string): void {
  const manifest = canonicalExactFile(binding.manifestPath)
  const expectedRoot = dirname(manifest)
  const expected = Compiler.readStorybookPackageRoot(expectedRoot)
  const actual = readStorybookPackageOwner(resolved)
  const name = binding.specifier.startsWith("@") ? binding.specifier.split("/").slice(0, 2).join("/") : binding.specifier.split("/")[0]
  if (expected.name !== name || actual === null || !Compiler.sameStorybookPackageOwner(expectedRoot, actual.root)) {
    throw new Error(`Shared Storybook source has a different package identity: ${binding.specifier}`)
  }
  const digest = createHash("sha256").update(readFileSync(manifest)).digest("hex")
  if (digest !== binding.manifestDigest) throw new Error(`Shared Storybook source manifest changed: ${binding.specifier}`)
  const expectedSource = Compiler.canonicalizeStorybookPackageFile(expectedRoot, canonicalExactFile(binding.sourcePath))
  const actualSource = Compiler.canonicalizeStorybookPackageFile(expectedRoot, resolved)
  if (fileIdentity(expectedSource) !== fileIdentity(actualSource)) {
    throw new Error(`Shared Storybook source export changed identity: ${binding.specifier}`)
  }
}

function fileIdentity(path: string): string {
  const file = statSync(path)
  return `${file.dev}:${file.ino}`
}

function publicModuleExports(value: unknown, packageName: string): readonly [string, string][] {
  if (typeof value === "string") return [[".", value]]
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Shared Storybook owner ${packageName} has no explicit exports`)
  }
  const entries: [string, string][] = []
  for (const [subpath, declaration] of Object.entries(value)) {
    if (declaration === null || typeof declaration !== "object" || Array.isArray(declaration)) continue
    const target = (declaration as Record<string, unknown>).browser
    if (!subpath.startsWith(".") || typeof target !== "string" || !target.endsWith(".js") || target.includes("*")) continue
    entries.push([subpath, target])
  }
  return entries
}

function canonicalOwnerTarget(packageRoot: string, target: string, specifier: string): string {
  if (!target.startsWith("./") || target.includes("\\")) {
    throw new Error(`Shared Storybook owner export is not one exact file: ${specifier}`)
  }
  const lexicalPath = resolve(packageRoot, target)
  if (lexicalPath !== packageRoot && !lexicalPath.startsWith(`${packageRoot}${sep}`)) {
    throw new Error(`Shared Storybook owner export escaped its package: ${specifier}`)
  }
  const path = realpathSync(lexicalPath)
  const owner = readStorybookPackageOwner(path)
  const packageName = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0]!
  if (!path.startsWith(`${packageRoot}${sep}`) || owner?.name !== packageName || owner.root !== packageRoot) {
    throw new Error(`Shared Storybook owner export changed identity: ${specifier}`)
  }
  return path
}

function parseObject(source: string, path: string): Record<string, unknown> {
  const value = JSON.parse(source)
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Shared Storybook owner manifest must be an object: ${path}`)
  }
  return value as Record<string, unknown>
}

/** Допускает только bare package imports, без URL, обхода директорий и private import maps. */
function isBareModuleSpecifier(value: unknown): value is string {
  return typeof value === "string" && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-zA-Z0-9._-]+)*$/u.test(value)
    && !value.split("/").some(part => part === "." || part === "..")
}

function isGovernedSpecifier(value: string): boolean {
  return STORYBOOK_SHARED_BROWSER_OWNER_PACKAGES.some(packageName =>
    value === packageName || value.startsWith(`${packageName}/`))
}

function validateSharedUrl(value: string, label: string): string {
  if (typeof value !== "string" || !value.startsWith("/__storybook/shared/") ||
    value.includes("\\") || value.includes("?") || value.includes("#") || value.includes("..")) {
    throw new Error(`Invalid shared Storybook ${label} URL: ${String(value)}`)
  }
  return value
}

/** Публикация и проверка одной identity готовых модулей. */
export default Object.freeze({
  build: buildPlatform,
  runWorker: runPlatformBuild,
  validateArtifacts: validatePlatformArtifacts,
  owners: STORYBOOK_SHARED_BROWSER_OWNER_PACKAGES,
  createModuleEntries: createStorybookSharedBrowserModuleEntries,
  validate: validateStorybookSharedBrowserIdentity,
  externalPlugin: createStorybookSharedBrowserExternalPlugin,
  identity: storybookSharedBrowserIdentity,
  exactFile: canonicalExactFile,
  directory: canonicalDirectory,
}) satisfies StorybookTechBuildEnvironment.Output
