/**
Определяет точную общую browser-среду из исходников владельцев и проверяет
неизменяемую identity до её участия в разрешении модулей.

@packageDocumentation
*/
import {buildPlatform, validatePlatformArtifacts} from "./src/build"
import {runPlatformBuild} from "./src/builder"
import Compiler from "@build/compiler"
import Protocol from "@build-environment/protocol"
import {createHash} from "node:crypto"
import {existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from "node:fs"
import {extname, join, resolve, sep} from "node:path"
import type {BuildEnvironment} from "./contract"
import type {
  StorybookSharedBrowserIdentity,
  StorybookSharedBrowserModule,
  StorybookSharedBrowserModuleEntry,
} from "./contract/types"
import {
  canonicalExactFile,
  canonicalDirectory,
} from "./src/paths"

const {conditionalExportTarget, readStorybookPackageOwner, isOwnedJsxProtocol} = Compiler

export type {BuildEnvironment} from "./contract"

/** Владельцы платформы, чьи browser-значения сохраняют одну identity в realm страницы. */
const STORYBOOK_SHARED_BROWSER_OWNER_PACKAGES = Object.freeze([
  "@renderer/html",
  "@zavx0z/browser",
  "@zavx0z/component",
  "@zavx0z/devtools",
  "@zavx0z/dom",
  "@zavx0z/engine",
  "@zavx0z/jsx",
  "@jsx-runtime/fragment",
  "@jsx/events",
  "@jsx-runtime/create",
  "@jsx-development/create",
  "@jsx-slot/plan",
  "@jsx-slot/child",
  "@zavx0z/space",
  "@zavx0z/template",
  "@zavx0z/webgpu",
] as const)

/**
Создаёт private entrypoints реальных публичных модулей владельцев.

Entrypoints реэкспортируют канонические файлы владельцев и служат только корнями
компиляции: они не вводят compatibility modules или альтернативные package identity.
*/
function createStorybookSharedBrowserModuleEntries(
  toolRoot: string,
  directory: string,
): readonly StorybookSharedBrowserModuleEntry[] {
  const entries: StorybookSharedBrowserModuleEntry[] = []
  mkdirSync(directory, {recursive: true})
  for (const packageName of STORYBOOK_SHARED_BROWSER_OWNER_PACKAGES) {
    const packageRoot = realpathSync(join(toolRoot, "node_modules", ...packageName.split("/")))
    const manifestPath = join(packageRoot, "package.json")
    const manifest = parseObject(readFileSync(manifestPath, "utf8"), manifestPath)
    if (manifest.name !== packageName) {
      throw new Error(`Shared Storybook owner mismatch: expected ${packageName}, found ${String(manifest.name)}`)
    }
    for (const [subpath, target] of publicModuleExports(manifest.exports, packageName)) {
      const sourcePath = canonicalOwnerTarget(packageRoot, target, `${packageName}${subpath === "." ? "" : subpath.slice(1)}`)
      if (!/\.[cm]?[jt]sx?$/u.test(extname(sourcePath))) continue
      const specifier = `${packageName}${subpath === "." ? "" : subpath.slice(1)}`
      const entryPath = join(directory, `${createHash("sha256").update(specifier).digest("hex")}.ts`)
      const hasDefault = new Bun.Transpiler({loader: transpilerLoader(sourcePath)})
        .scan(readFileSync(sourcePath, "utf8")).exports.includes("default")
      writeFileSync(entryPath, [
        `export * from ${JSON.stringify(sourcePath)}`,
        ...(hasDefault ? [`export {default} from ${JSON.stringify(sourcePath)}`] : []),
        "",
      ].join("\n"))
      entries.push(Object.freeze({specifier, sourcePath, entryPath}))
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
    return Object.freeze({specifier: module.specifier, sourcePath: resolve(module.sourcePath), url})
  })
  const expectedEpoch = createHash("sha256").update(JSON.stringify({
    modules: modules.map(({specifier, url}) => ({specifier, url})),
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
): Bun.BunPlugin {
  const validated = validateStorybookSharedBrowserIdentity(identity)
  const urls = new Map(validated.modules.map(({specifier, url}) => [specifier, url]))
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
    },
  }
}

function storybookSharedBrowserIdentity(
  packageEntryUrl: string,
  modules: readonly StorybookSharedBrowserModule[],
  hostModuleEpoch: string,
): StorybookSharedBrowserIdentity {
  const epoch = createHash("sha256").update(JSON.stringify({
    modules: modules.map(({specifier, url}) => ({specifier, url})),
  })).digest("hex")
  return validateStorybookSharedBrowserIdentity({
    protocol: Protocol,
    epoch,
    hostModuleEpoch,
    packageEntryUrl,
    modules,
  })
}

function publicModuleExports(value: unknown, packageName: string): readonly [string, string][] {
  if (typeof value === "string") return [[".", value]]
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Shared Storybook owner ${packageName} has no explicit exports`)
  }
  const entries: [string, string][] = []
  for (const [subpath, declaration] of Object.entries(value)) {
    const target = conditionalExportTarget(declaration, ["browser", "import"])
    if (!subpath.startsWith(".") || target === null || target.includes("*")) continue
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
  if (owner?.name !== packageName && !isOwnedJsxProtocol(packageRoot, specifier, owner)) {
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

function transpilerLoader(path: string): Bun.JavaScriptLoader {
  switch (extname(path).toLowerCase()) {
    case ".tsx": return "tsx"
    case ".jsx": return "jsx"
    case ".js":
    case ".mjs":
    case ".cjs": return "js"
    default: return "ts"
  }
}

/** Сборка и проверка одной exact module identity из авторских файлов. */
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
}) satisfies BuildEnvironment.Output
