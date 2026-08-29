import {createHash} from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs"
import {dirname, extname, isAbsolute, join, relative, resolve, sep} from "node:path"
import {fileURLToPath} from "node:url"
import {
  generateStorybookLoaderSource,
  type StorybookGeneratedVariant,
} from "./generated-loader.ts"
import {createStorybookPackageCompilerPlugins} from "./compiler.ts"
import {
  storybookBuildError,
  storybookDiagnostic,
  type StorybookPackageBuildDescriptor,
  type StorybookPackageRevisionBuilder,
} from "./package-session.ts"

export type StorybookCompilerPluginResolver = (
  input: Readonly<{
    packageRoot: string
    projectRoot: string
    sourcePaths: readonly string[]
  }>,
) => Promise<readonly Bun.BunPlugin[]>

export type CreateStorybookPackageRevisionBuilderOptions = Readonly<{
  browserEntryPath?: string
  runtimeProtocolPath?: string
  resolveCompilerPlugins?: StorybookCompilerPluginResolver
}>

let packageBuildTail: Promise<void> = Promise.resolve()

/** Creates the real Bun browser builder used independently by each PackageSession. */
export function createStorybookPackageRevisionBuilder(
  options: CreateStorybookPackageRevisionBuilderOptions = {},
): StorybookPackageRevisionBuilder {
  const browserEntryPath = realpathSync(options.browserEntryPath ?? fileURLToPath(
    new URL("./browser/package-entry.ts", import.meta.url),
  ))
  const runtimeProtocolPath = realpathSync(options.runtimeProtocolPath ?? fileURLToPath(
    new URL("./runtime-protocol.ts", import.meta.url),
  ))
  const resolvePlugins = options.resolveCompilerPlugins ?? (async ({
    packageRoot,
    projectRoot,
    sourcePaths,
  }) => createStorybookPackageCompilerPlugins({
    packageRoot,
    projectRoot,
    moduleSourcePaths: sourcePaths,
  }))

  return (input) => withPackageBuildLock(async () => {
    const {descriptor, candidateRevision, revisionUrl, stagingDirectory} = input
    mkdirSync(stagingDirectory, {recursive: true})
    const modules = descriptor.runtime === null
      ? []
      : [descriptor.runtime, ...descriptor.variants.map(({module}) => module)]
    const sourcePaths = Object.freeze(modules.map(({path}) => path))
    const compilerInput = Object.freeze({
      packageRoot: descriptor.packageRoot,
      projectRoot: descriptor.projectRoot,
      sourcePaths,
    })
    const validationPlugins = Object.freeze([...(await resolvePlugins(compilerInput))])
    validatePlugins(validationPlugins)
    await validateModuleExports(descriptor, validationPlugins, stagingDirectory)
    const plugins = Object.freeze([...(await resolvePlugins(compilerInput))])
    validatePlugins(plugins)

    const loaderPath = join(stagingDirectory, "generated-loaders.ts")
    const entryPath = join(stagingDirectory, "package-entry.ts")
    if (descriptor.runtime === null) {
      await Bun.write(loaderPath, [
        "export const STORYBOOK_PACKAGE_STORY_LOADERS = new Map()",
        "export const storybookVariantRoutes = Object.freeze([])",
        `export const storybookRevisionUrl = ${JSON.stringify(revisionUrl)}`,
        "export const loadStorybookPackageRuntime = null",
        "",
      ].join("\n"))
    } else {
      const variants: readonly StorybookGeneratedVariant[] = descriptor.variants.map(({route, module}) => ({
        route,
        module,
      }))
      await Bun.write(loaderPath, generateStorybookLoaderSource({
        revisionUrl,
        runtime: descriptor.runtime,
        variants,
      }))
    }
    await Bun.write(entryPath, [
      `import {startExternalStorybookPackage} from ${JSON.stringify(browserEntryPath)}`,
      "import {",
      "  loadStorybookPackageRuntime,",
      "  STORYBOOK_PACKAGE_STORY_LOADERS,",
      "  storybookRevisionUrl,",
      "} from \"./generated-loaders.ts\"",
      "",
      "await startExternalStorybookPackage({",
      `  packageId: ${JSON.stringify(descriptor.packageId)},`,
      `  candidateRevision: ${JSON.stringify(candidateRevision)},`,
      "  revisionUrl: storybookRevisionUrl,",
      "  loadRuntime: loadStorybookPackageRuntime,",
      "  storyLoaders: STORYBOOK_PACKAGE_STORY_LOADERS,",
      "})",
      "",
    ].join("\n"))

    const result = await Bun.build({
      entrypoints: [entryPath],
      outdir: stagingDirectory,
      naming: {
        entry: "entry.[ext]",
        chunk: "chunks/[name]-[hash].[ext]",
        asset: "assets/[name]-[hash].[ext]",
      },
      publicPath: revisionUrl,
      target: "browser",
      format: "esm",
      splitting: true,
      sourcemap: "external",
      minify: false,
      loader: {".wgsl": "text"},
      plugins: [...plugins],
      metafile: true,
      throw: false,
    })
    if (!result.success) throw buildLogsError("compile", result.logs)
    const metafile = result.metafile
    if (metafile === undefined) throw storybookBuildError(storybookDiagnostic("link", "Bun emitted no package metafile"))
    const stagingPrefix = `${realpathSync(stagingDirectory)}${sep}`
    const dependencyRealpaths = Object.freeze(canonicalBuildInputs(
      metafile.inputs,
      descriptor.projectRoot,
    ).filter((path) => !path.startsWith(stagingPrefix)))
    validateConsumerBoundary(dependencyRealpaths, descriptor, stagingDirectory)
    validatePackageIdentities(dependencyRealpaths)
    if (descriptor.runtime !== null) {
      const protocolPlugins = Object.freeze([...(await resolvePlugins(compilerInput))])
      validatePlugins(protocolPlugins)
      await validateRuntimeProtocol(
        descriptor,
        runtimeProtocolPath,
        stagingDirectory,
        protocolPlugins,
      )
    }
    const entryOutput = result.outputs.find((output) => output.kind === "entry-point")
    if (entryOutput === undefined) {
      throw storybookBuildError(storybookDiagnostic("link", "Package build emitted no entry point"))
    }
    const entryRelativePath = relative(stagingDirectory, entryOutput.path)
    const moduleGraphRevision = await buildRevisionDigest(
      descriptor,
      dependencyRealpaths,
      result.outputs,
      metafile.inputs,
    )
    rmSync(validationOutputPath(stagingDirectory), {recursive: true, force: true})
    rmSync(join(stagingDirectory, ".protocol"), {recursive: true, force: true})
    for (const path of [loaderPath, entryPath, join(stagingDirectory, "validate-exports.ts"), join(stagingDirectory, "validate-runtime.ts")]) {
      rmSync(path, {force: true})
    }
    return Object.freeze({
      moduleGraphRevision,
      dependencyRealpaths,
      entryRelativePath,
    })
  })
}

async function withPackageBuildLock<Value>(operation: () => Promise<Value>): Promise<Value> {
  const previous = packageBuildTail
  let release!: () => void
  packageBuildTail = new Promise<void>((resolvePromise) => {
    release = resolvePromise
  })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

async function validateModuleExports(
  descriptor: StorybookPackageBuildDescriptor,
  plugins: readonly Bun.BunPlugin[],
  stagingDirectory: string,
): Promise<void> {
  if (descriptor.runtime === null) return
  const validationPath = join(stagingDirectory, "validate-exports.ts")
  const modules = [descriptor.runtime, ...descriptor.variants.map(({module}) => module)]
  for (const module of modules) validateScannedExport(module.path, module.export)
  await Bun.write(validationPath, [
    ...modules.map((module, index) =>
      `import {${module.export} as storybookExport${index}} from ${JSON.stringify(module.path)}`),
    `void [${modules.map((_module, index) => `storybookExport${index}`).join(", ")}]`,
    "",
  ].join("\n"))
  const validationOutput = validationOutputPath(stagingDirectory)
  const result = await Bun.build({
    entrypoints: [validationPath],
    outdir: validationOutput,
    target: "browser",
    format: "esm",
    splitting: false,
    minify: false,
    loader: {".wgsl": "text"},
    plugins: [...plugins],
    throw: false,
  })
  if (!result.success) throw buildLogsError("validate", result.logs)
}

function validateScannedExport(path: string, exportName: string): void {
  const loader = transpilerLoader(path)
  let exports: readonly string[]
  try {
    exports = new Bun.Transpiler({loader}).scan(readFileSync(path, "utf8")).exports
  } catch (error) {
    throw storybookBuildError(storybookDiagnostic(
      "validate",
      `Cannot scan module exports: ${error instanceof Error ? error.message : String(error)}`,
      path,
    ))
  }
  if (!exports.includes(exportName)) {
    throw storybookBuildError(storybookDiagnostic(
      "validate",
      `Module does not export ${exportName}`,
      path,
    ))
  }
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

function validationOutputPath(stagingDirectory: string): string {
  return join(stagingDirectory, ".validate")
}

async function validateRuntimeProtocol(
  descriptor: StorybookPackageBuildDescriptor,
  runtimeProtocolPath: string,
  stagingDirectory: string,
  plugins: readonly Bun.BunPlugin[],
): Promise<void> {
  const runtime = descriptor.runtime
  if (runtime === null) return
  const validationPath = join(stagingDirectory, "validate-runtime.ts")
  await Bun.write(validationPath, [
    `import {validateStorybookRuntimeAdapter} from ${JSON.stringify(runtimeProtocolPath)}`,
    `import {${runtime.export} as candidate} from ${JSON.stringify(runtime.path)}`,
    "validateStorybookRuntimeAdapter(candidate)",
    "",
  ].join("\n"))
  const outputDirectory = join(stagingDirectory, ".protocol")
  const build = await Bun.build({
    entrypoints: [validationPath],
    outdir: outputDirectory,
    naming: {entry: "protocol.[ext]"},
    target: "bun",
    format: "esm",
    splitting: false,
    minify: false,
    loader: {".wgsl": "text"},
    plugins: [...plugins],
    throw: false,
  })
  if (!build.success) throw buildLogsError("protocol", build.logs)
  const entry = build.outputs.find(({kind}) => kind === "entry-point")
  if (entry === undefined) {
    throw storybookBuildError(storybookDiagnostic("protocol", "Runtime protocol build emitted no entry", runtime.path))
  }
  const child = Bun.spawn([process.execPath, entry.path], {
    cwd: descriptor.projectRoot,
    env: {...Bun.env, STORYBOOK_PROTOCOL_VALIDATION: "1"},
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) {
    const message = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n") ||
      `Runtime protocol validation exited ${exitCode}`
    throw storybookBuildError(storybookDiagnostic("protocol", message, runtime.path))
  }
}

function canonicalBuildInputs(
  inputs: Readonly<Record<string, unknown>>,
  projectRoot: string,
): readonly string[] {
  const paths = Object.keys(inputs).flatMap((path) => {
    if (path.startsWith("<") || path.startsWith("node:")) return []
    const candidates = isAbsolute(path)
      ? [path]
      : [resolve(projectRoot, path), resolve(process.cwd(), path)]
    const candidate = candidates.find(existsSync)
    return candidate === undefined ? [] : [realpathSync(candidate)]
  })
  return Object.freeze([...new Set(paths)].sort())
}

function validateConsumerBoundary(
  paths: readonly string[],
  descriptor: StorybookPackageBuildDescriptor,
  stagingDirectory: string,
): void {
  const roots = [descriptor.packageRoot, descriptor.projectRoot].map((path) => `${realpathSync(path)}${sep}`)
  const staging = `${resolve(stagingDirectory)}${sep}`
  for (const path of paths) {
    if (path.startsWith(staging) || !roots.some((root) => path.startsWith(root))) continue
    const source = readFileSync(path, "utf8")
    if (/from\s+["']@zavx0z\/storybook(?:\/[^"']*)?["']|import\s*\(\s*["']@zavx0z\/storybook/gu.test(source)) {
      throw storybookBuildError(storybookDiagnostic(
        "validate",
        "Consumer package imports external Storybook",
        path,
      ))
    }
  }
}

function validatePackageIdentities(paths: readonly string[]): void {
  const identities = new Map<string, string>()
  for (const path of paths) {
    const owner = nearestPackage(path)
    if (owner === null) continue
    const current = identities.get(owner.name)
    if (current !== undefined && current !== owner.root) {
      throw storybookBuildError(storybookDiagnostic(
        "link",
        `Package ${owner.name} resolved to two realpaths: ${current} and ${owner.root}`,
      ))
    }
    identities.set(owner.name, owner.root)
  }
}

function nearestPackage(path: string): Readonly<{name: string, root: string}> | null {
  let directory = dirname(path)
  while (directory !== dirname(directory)) {
    const manifestPath = join(directory, "package.json")
    if (existsSync(manifestPath)) {
      try {
        const value = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>
        if (typeof value.name === "string" && value.name.length > 0) {
          return Object.freeze({name: value.name, root: realpathSync(directory)})
        }
      } catch {
        return null
      }
    }
    directory = dirname(directory)
  }
  return null
}

async function buildRevisionDigest(
  descriptor: StorybookPackageBuildDescriptor,
  inputs: readonly string[],
  outputs: readonly Bun.BuildArtifact[],
  inputMetadata: Readonly<Record<string, unknown>>,
): Promise<string> {
  const hash = createHash("sha256")
    .update(`${descriptor.declarationDigest}\0${descriptor.packageId}\0`)
  for (const path of inputs) hash.update(`${path}\0`)
  hash.update(`${JSON.stringify(inputMetadata)}\0`)
  for (const output of [...outputs].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(`${basename(output.path)}\0`)
    hash.update(new Uint8Array(await output.arrayBuffer()))
  }
  return hash.digest("hex")
}

function validatePlugins(plugins: readonly Bun.BunPlugin[]): void {
  for (const [index, plugin] of plugins.entries()) {
    if (plugin === null || typeof plugin !== "object" ||
      typeof plugin.name !== "string" || plugin.name.trim().length === 0 ||
      typeof plugin.setup !== "function") {
      throw storybookBuildError(storybookDiagnostic("compile", `Compiler plugin ${index} is invalid`))
    }
  }
}

function buildLogsError(
  phase: "validate" | "compile" | "protocol",
  logs: readonly (BuildMessage | ResolveMessage)[],
): Error {
  const diagnostics = logs.map((log) => storybookDiagnostic(
    phase,
    log.message,
    log.position?.file ?? null,
  ))
  return storybookBuildError(diagnostics.length === 0
    ? storybookDiagnostic(phase, "Bun build failed without diagnostics")
    : diagnostics)
}

function basename(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return index < 0 ? path : path.slice(index + 1)
}
