import {createHash} from "node:crypto"
import {existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from "node:fs"
import {extname, join, resolve, sep} from "node:path"
import type {
  StorybookSharedBrowserIdentity,
  StorybookSharedBrowserModule,
  StorybookSharedBrowserSourceFile,
} from "./types/shared-module-identity.ts"
import {readStorybookPackageOwner} from "../src/shared/owner-identity.ts"

/** Владельцы платформы, чьи browser-значения сохраняют одну identity в realm страницы. */
export const STORYBOOK_SHARED_BROWSER_OWNER_PACKAGES = Object.freeze([
  "@renderer/html",
  "@zavx0z/browser",
  "@zavx0z/component",
  "@zavx0z/devtools",
  "@zavx0z/dom",
  "@zavx0z/engine",
  "@zavx0z/space",
  "@zavx0z/template",
  "@zavx0z/webgpu",
] as const)

export type StorybookSharedBrowserModuleEntry = Readonly<{
  specifier: string
  sourcePath: string
  entryPath: string
}>

/**
Создаёт private entrypoints реальных публичных модулей владельцев.

Entrypoints реэкспортируют канонические файлы владельцев и служат только корнями
компиляции: они не вводят compatibility modules или альтернативные package identity.
*/
export function createStorybookSharedBrowserModuleEntries(
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
      if (specifier === "@zavx0z/template/bun" || specifier.startsWith("@zavx0z/template/compiler")) continue
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

/** Проверяет сериализованную shared identity до её участия в Bun resolution. */
export function validateStorybookSharedBrowserIdentity(
  value: StorybookSharedBrowserIdentity,
): StorybookSharedBrowserIdentity {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    value.protocol !== "storybook-shared-browser-identity/1") {
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
  if (!Array.isArray(value.sourceFiles) || value.sourceFiles.length === 0) {
    throw new TypeError("Shared Storybook browser source files must be a non-empty list")
  }
  const specifiers = new Set<string>()
  const urls = new Set<string>()
  const modules = value.modules.map((module, index): StorybookSharedBrowserModule => {
    if (module === null || typeof module !== "object" || Array.isArray(module)) {
      throw new TypeError(`Shared Storybook browser module ${index} must be an object`)
    }
    if (!isGovernedSpecifier(module.specifier)) {
      throw new Error(`Unknown shared Storybook browser module: ${String(module.specifier)}`)
    }
    if (specifiers.has(module.specifier)) throw new Error(`Duplicate shared Storybook module: ${module.specifier}`)
    const url = validateSharedUrl(module.url, `module ${module.specifier}`)
    if (urls.has(url)) throw new Error(`Duplicate shared Storybook module URL: ${url}`)
    if (typeof module.sourcePath !== "string" || !module.sourcePath.startsWith("/") || !existsSync(module.sourcePath)) {
      throw new Error(`Invalid shared Storybook module source: ${String(module.sourcePath)}`)
    }
    specifiers.add(module.specifier)
    urls.add(url)
    return Object.freeze({specifier: module.specifier, sourcePath: realpathSync(module.sourcePath), url})
  })
  const sourcePaths = new Set<string>()
  const sourceFiles = value.sourceFiles.map((file, index): StorybookSharedBrowserSourceFile => {
    if (file === null || typeof file !== "object" || Array.isArray(file) ||
      typeof file.path !== "string" || !file.path.startsWith("/") ||
      typeof file.contentDigest !== "string" || !/^[a-f0-9]{64}$/u.test(file.contentDigest)) {
      throw new TypeError(`Invalid shared Storybook browser source file ${index}`)
    }
    const path = realpathSync(file.path)
    if (sourcePaths.has(path)) throw new Error(`Duplicate shared Storybook browser source file: ${path}`)
    const contentDigest = createHash("sha256").update(readFileSync(path)).digest("hex")
    if (contentDigest !== file.contentDigest) {
      throw new Error(`Shared Storybook browser source changed after kernel build: ${path}`)
    }
    sourcePaths.add(path)
    return Object.freeze({path, contentDigest})
  })
  for (const module of modules) {
    if (!sourcePaths.has(module.sourcePath)) {
      throw new Error(`Shared Storybook module has no source evidence: ${module.specifier}`)
    }
  }
  return Object.freeze({
    protocol: "storybook-shared-browser-identity/1",
    epoch: value.epoch,
    hostModuleEpoch: value.hostModuleEpoch,
    packageEntryUrl,
    modules: Object.freeze(modules),
    sourceFiles: Object.freeze(sourceFiles),
  })
}

/** Сохраняет governed imports как browser imports общих immutable entrypoints. */
export function createStorybookSharedBrowserExternalPlugin(
  identity: StorybookSharedBrowserIdentity,
): Bun.BunPlugin {
  const validated = validateStorybookSharedBrowserIdentity(identity)
  const urls = new Map(validated.modules.map(({specifier, url}) => [specifier, url]))
  return {
    name: "external-storybook-shared-browser-identity",
    setup(builder) {
      builder.onResolve({filter: /^(?:@nodes|@renderer|@webxr|@zavx0z)\//u}, ({path}) => {
        if (!isGovernedSpecifier(path)) return undefined
        const url = urls.get(path)
        if (url === undefined) throw new Error(`Shared Storybook browser identity has no module ${path}`)
        return {path: url, external: true}
      })
      builder.onResolve({filter: /^\/__storybook\/shared\//u}, ({path}) => ({path, external: true}))
    },
  }
}

export function storybookSharedBrowserIdentity(
  packageEntryUrl: string,
  modules: readonly StorybookSharedBrowserModule[],
  hostModuleEpoch: string,
  sourceFiles: readonly StorybookSharedBrowserSourceFile[] = modules.map(({sourcePath}) => ({
    path: sourcePath,
    contentDigest: createHash("sha256").update(readFileSync(sourcePath)).digest("hex"),
  })),
): StorybookSharedBrowserIdentity {
  const epoch = createHash("sha256").update(JSON.stringify({
    modules: modules.map(({specifier, url}) => ({specifier, url})),
  })).digest("hex")
  return validateStorybookSharedBrowserIdentity({
    protocol: "storybook-shared-browser-identity/1",
    epoch,
    hostModuleEpoch,
    packageEntryUrl,
    modules,
    sourceFiles,
  })
}

function publicModuleExports(value: unknown, packageName: string): readonly [string, string][] {
  if (typeof value === "string") return [[".", value]]
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Shared Storybook owner ${packageName} has no explicit exports`)
  }
  const entries: [string, string][] = []
  for (const [subpath, target] of Object.entries(value)) {
    if (!subpath.startsWith(".") || typeof target !== "string" || target.includes("*")) continue
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
  if (owner?.name !== packageName) {
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
