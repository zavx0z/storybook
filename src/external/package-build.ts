import {createHash, randomUUID} from "node:crypto"
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import {dirname, extname, isAbsolute, join, relative, resolve, sep} from "node:path"
import {fileURLToPath} from "node:url"
import {
  generateStorybookLoaderSource,
  type StorybookGeneratedVariant,
  type StorybookGeneratedWidget,
} from "./generated-loader.ts"
import {createStorybookPackageCompilerPlugins} from "./compiler.ts"
import {
  canonicalizeStorybookPackageFile,
  preferredStorybookPackageRoot,
  readStorybookPackageOwner,
  sameStorybookPackageOwner,
} from "./owner-identity.ts"
import {
  storybookBuildError,
  storybookDiagnostic,
  type StorybookPackageBuildDescriptor,
  type StorybookPackageRevisionResourceFile,
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
  workerPath?: string
  resolveCompilerPlugins?: StorybookCompilerPluginResolver
}>

export type StorybookPackageBuildWorkerJob = Readonly<{
  input: Omit<Parameters<StorybookPackageRevisionBuilder>[0], "signal">
  options: Readonly<{
    browserEntryPath: string
    runtimeProtocolPath: string
  }>
}>

export type StorybookPackageBuildWorkerResult = Readonly<{
  ok: true
  build: Awaited<ReturnType<StorybookPackageRevisionBuilder>>
}> | Readonly<{
  ok: false
  message: string
  diagnostics: readonly Readonly<{phase: string, message: string, path: string | null}>[]
}>

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
  const workerPath = realpathSync(options.workerPath ?? fileURLToPath(
    new URL("./package-build-worker.ts", import.meta.url),
  ))
  if (options.resolveCompilerPlugins !== undefined) {
    return (input) => buildStorybookPackageRevisionInProcess(input, options)
  }
  return (input) => runPackageBuildWorker(input, {browserEntryPath, runtimeProtocolPath}, workerPath)
}

/** In-process implementation used only inside the isolated package-build worker and focused seams. */
export async function buildStorybookPackageRevisionInProcess(
  input: Parameters<StorybookPackageRevisionBuilder>[0],
  options: CreateStorybookPackageRevisionBuilderOptions = {},
): Promise<Awaited<ReturnType<StorybookPackageRevisionBuilder>>> {
  input.signal.throwIfAborted()
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

  return (async () => {
    const {descriptor, candidateRevision, revisionUrl, stagingDirectory} = input
    input.signal.throwIfAborted()
    mkdirSync(stagingDirectory, {recursive: true})
    for (const resource of descriptor.resourceFiles ?? []) {
      let attestedBytes: Buffer | null = null
      if (resource.contentDigest !== undefined) {
        attestedBytes = readAttestedRevisionResource(resource)
        const actualDigest = createHash("sha256").update(attestedBytes).digest("hex")
        if (actualDigest !== resource.contentDigest) {
          throw storybookBuildError(storybookDiagnostic(
            "publish",
            `Revision resource content changed after resolution: ${resource.targetPath}`,
            resource.sourcePath,
          ))
        }
      }
      const target = resolve(stagingDirectory, resource.targetPath)
      if (!target.startsWith(`${resolve(stagingDirectory)}${sep}`)) {
        throw storybookBuildError(storybookDiagnostic("publish", "Revision resource escaped staging", target))
      }
      mkdirSync(dirname(target), {recursive: true})
      if (attestedBytes === null) copyFileSync(resource.sourcePath, target)
      else writeFileSync(target, attestedBytes)
    }
    const modules = [
      ...(descriptor.runtime === null ? [] : [descriptor.runtime]),
      ...descriptor.variants.map(({module}) => module),
      ...descriptor.widgetModules.map(({module}) => module),
    ]
    const sourcePaths = Object.freeze(modules.map(({path}) => path))
    const compilerInput = Object.freeze({
      packageRoot: descriptor.packageRoot,
      projectRoot: descriptor.projectRoot,
      sourcePaths,
    })
    const validationPlugins = Object.freeze([...(await resolvePlugins(compilerInput))])
    input.signal.throwIfAborted()
    validatePlugins(validationPlugins)
    await validateModuleExports(descriptor, validationPlugins, stagingDirectory)
    const plugins = Object.freeze([...(await resolvePlugins(compilerInput))])
    validatePlugins(plugins)

    const loaderPath = join(stagingDirectory, "generated-loaders.ts")
    const entryPath = join(stagingDirectory, "package-entry.ts")
    const graphPath = join(stagingDirectory, "package-graph.json")
    await Bun.write(graphPath, `${JSON.stringify(descriptor.graphSnapshot)}\n`)
    const variants: readonly StorybookGeneratedVariant[] = descriptor.variants.map(({route, module}) => ({
      route,
      module,
    }))
    const widgets: readonly StorybookGeneratedWidget[] = descriptor.widgetModules.map(({id, module}) => ({
      id,
      module,
    }))
    await Bun.write(loaderPath, generateStorybookLoaderSource({
      revisionUrl,
      runtime: descriptor.runtime,
      variants,
      widgets,
    }))
    await Bun.write(entryPath, [
      `import {startExternalStorybookPackage} from ${JSON.stringify(browserEntryPath)}`,
      "import {",
      "  loadStorybookPackageRuntime,",
      "  STORYBOOK_PACKAGE_STORY_LOADERS,",
      "  STORYBOOK_PACKAGE_WIDGET_LOADERS,",
      "  storybookRevisionUrl,",
      "} from \"./generated-loaders.ts\"",
      "",
      "await startExternalStorybookPackage({",
      `  packageId: ${JSON.stringify(descriptor.packageId)},`,
      `  candidateRevision: ${JSON.stringify(candidateRevision)},`,
      `  graphSnapshot: ${JSON.stringify(descriptor.graphSnapshot)},`,
      "  revisionUrl: storybookRevisionUrl,",
      "  loadRuntime: loadStorybookPackageRuntime,",
      "  storyLoaders: STORYBOOK_PACKAGE_STORY_LOADERS,",
      "  widgetLoaders: STORYBOOK_PACKAGE_WIDGET_LOADERS,",
      "})",
      "",
    ].join("\n"))

    input.signal.throwIfAborted()
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
    const dependencyRealpaths = canonicalizeStorybookPackageIdentities(canonicalBuildInputs(
      metafile.inputs,
      descriptor.projectRoot,
    ).filter((path) => !path.startsWith(stagingPrefix)))
    validateConsumerBoundary(dependencyRealpaths, descriptor, stagingDirectory)
    if (descriptor.runtime !== null) {
      const protocolPlugins = Object.freeze([...(await resolvePlugins(compilerInput))])
      validatePlugins(protocolPlugins)
      await validateRuntimeProtocol(
        descriptor,
        runtimeProtocolPath,
        stagingDirectory,
        protocolPlugins,
        input.signal,
        input.protocolTimeoutMs,
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
  })()
}

function readAttestedRevisionResource(
  resource: StorybookPackageRevisionResourceFile,
): Buffer {
  if (resource.sourceRoot === undefined) {
    throw storybookBuildError(storybookDiagnostic(
      "publish",
      `Attested revision resource has no exact source root: ${resource.targetPath}`,
      resource.sourcePath,
    ))
  }
  let descriptor: number
  try {
    descriptor = openSync(resource.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    throw storybookBuildError(storybookDiagnostic(
      "publish",
      `Attested revision resource must remain an exact non-symlink file: ${resource.targetPath}`,
      resource.sourcePath,
    ))
  }
  try {
    const canonical = realpathSync(resource.sourcePath)
    const sourceRoot = realpathSync(resource.sourceRoot)
    const local = relative(sourceRoot, canonical)
    if (local === "" || local.startsWith("..") || isAbsolute(local)) {
      throw storybookBuildError(storybookDiagnostic(
        "publish",
        `Attested revision resource escaped its exact source root: ${resource.targetPath}`,
        resource.sourcePath,
      ))
    }
    const opened = fstatSync(descriptor)
    const current = statSync(canonical)
    if (!opened.isFile() || opened.dev !== current.dev || opened.ino !== current.ino) {
      throw storybookBuildError(storybookDiagnostic(
        "publish",
        `Attested revision resource changed during publication: ${resource.targetPath}`,
        resource.sourcePath,
      ))
    }
    return readFileSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

async function runPackageBuildWorker(
  input: Parameters<StorybookPackageRevisionBuilder>[0],
  options: Readonly<{browserEntryPath: string, runtimeProtocolPath: string}>,
  workerPath: string,
): Promise<Awaited<ReturnType<StorybookPackageRevisionBuilder>>> {
  input.signal.throwIfAborted()
  mkdirSync(input.stagingDirectory, {recursive: true})
  const nonce = randomUUID()
  const jobPath = join(input.stagingDirectory, `.build-job-${nonce}.json`)
  const resultPath = join(input.stagingDirectory, `.build-result-${nonce}.json`)
  const {signal: _signal, ...serializableInput} = input
  const job: StorybookPackageBuildWorkerJob = Object.freeze({
    input: serializableInput,
    options,
  })
  await Bun.write(jobPath, `${JSON.stringify(job)}\n`)
  const child = Bun.spawn([process.execPath, workerPath, jobPath, resultPath], {
    cwd: input.descriptor.projectRoot,
    env: {...Bun.env, STORYBOOK_PACKAGE_BUILD_WORKER: "1"},
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  })
  try {
    const {exitCode, stderr} = await waitForChild(
      child,
      input.signal,
      input.compileTimeoutMs,
      "Storybook package compile",
    )
    input.signal.throwIfAborted()
    if (!existsSync(resultPath)) {
      throw storybookBuildError(storybookDiagnostic(
        exitCode === 0 ? "compile" : "compile",
        stderr.trim() || `Storybook package build worker exited ${exitCode} without a result`,
      ))
    }
    const result = JSON.parse(readFileSync(resultPath, "utf8")) as StorybookPackageBuildWorkerResult
    if (result.ok) return result.build
    const diagnostics = result.diagnostics.flatMap((diagnostic) =>
      isWorkerDiagnosticPhase(diagnostic.phase)
        ? [storybookDiagnostic(diagnostic.phase, diagnostic.message, diagnostic.path)]
        : [])
    throw storybookBuildError(diagnostics.length > 0
      ? diagnostics
      : storybookDiagnostic("compile", result.message))
  } finally {
    rmSync(jobPath, {force: true})
    rmSync(resultPath, {force: true})
  }
}

async function waitForChild(
  child: any,
  signal: AbortSignal,
  timeoutMs: number,
  label: string,
): Promise<Readonly<{exitCode: number, stdout: string, stderr: string}>> {
  let timedOut = false
  let abortReason: unknown = null
  let hardKill: ReturnType<typeof setTimeout> | null = null
  const terminate = (reason: unknown, timeout: boolean): void => {
    abortReason = reason
    timedOut = timeout
    try {
      child.kill()
      hardKill = setTimeout(() => {
        try {
          child.kill(9)
        } catch {
          // The exact child already exited.
        }
      }, 250)
    } catch {
      // The exact child already exited.
    }
  }
  const onAbort = (): void => terminate(signal.reason, false)
  signal.addEventListener("abort", onAbort, {once: true})
  const timer = setTimeout(() => terminate(new Error(`${label} timed out after ${timeoutMs}ms`), true), timeoutMs)
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      readBoundedStream(child.stdout, 64 * 1024),
      readBoundedStream(child.stderr, 64 * 1024),
    ])
    if (signal.aborted) throw abortReason instanceof Error ? abortReason : signal.reason
    if (timedOut) {
      const error = storybookBuildError(storybookDiagnostic(
        "timeout",
        abortReason instanceof Error ? abortReason.message : `${label} timed out`,
      ))
      error.name = "TimeoutError"
      throw error
    }
    return Object.freeze({exitCode, stdout, stderr})
  } finally {
    clearTimeout(timer)
    if (hardKill !== null) clearTimeout(hardKill)
    signal.removeEventListener("abort", onAbort)
  }
}

async function readBoundedStream(stream: unknown, limit: number): Promise<string> {
  if (stream === null || stream === undefined || typeof stream === "number") return ""
  const reader = (stream as ReadableStream<Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (length < limit) {
      const next = await reader.read()
      if (next.done) break
      const remaining = limit - length
      const chunk = next.value.byteLength <= remaining ? next.value : next.value.slice(0, remaining)
      chunks.push(chunk)
      length += chunk.byteLength
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const value = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    value.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(value)
}

function isWorkerDiagnosticPhase(
  value: string,
): value is Parameters<typeof storybookDiagnostic>[0] {
  return ["resolve", "validate", "compile", "link", "protocol", "publish", "watch", "activation", "timeout"]
    .includes(value)
}

async function validateModuleExports(
  descriptor: StorybookPackageBuildDescriptor,
  plugins: readonly Bun.BunPlugin[],
  stagingDirectory: string,
): Promise<void> {
  const validationPath = join(stagingDirectory, "validate-exports.ts")
  const modules = [
    ...(descriptor.runtime === null ? [] : [descriptor.runtime]),
    ...descriptor.variants.map(({module}) => module),
    ...descriptor.widgetModules.map(({module}) => module),
  ]
  if (modules.length === 0) return
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
  signal: AbortSignal,
  timeoutMs: number,
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
  const {exitCode, stdout, stderr} = await waitForChild(
    child,
    signal,
    timeoutMs,
    "Storybook runtime protocol validation",
  )
  if (exitCode !== 0) {
    const message = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n") ||
      `Runtime protocol validation exited ${exitCode}`
    throw storybookBuildError(storybookDiagnostic("protocol", message, runtime.path))
  }
}

export function canonicalBuildInputs(
  inputs: Readonly<Record<string, unknown>>,
  projectRoot: string,
): readonly string[] {
  const paths = Object.keys(inputs).flatMap((path) => {
    if (path.startsWith("<") || path.startsWith("node:")) return []
    const candidates = isAbsolute(path)
      ? [path]
      : [resolve(projectRoot, path), resolve(process.cwd(), path)]
    const candidate = candidates.find(existsSync)
    return candidate === undefined ? [] : [stableBuildInputPath(candidate)]
  })
  return Object.freeze([...new Set(paths)].sort())
}

function stableBuildInputPath(path: string): string {
  const absolute = resolve(path)
  return join(realpathSync(dirname(absolute)), basename(absolute))
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

export function canonicalizeStorybookPackageIdentities(paths: readonly string[]): readonly string[] {
  const identities = new Map<string, {paths: string[]; root: string}>()
  for (const path of paths) {
    const owner = readStorybookPackageOwner(path)
    if (owner === null) continue
    const current = identities.get(owner.name)
    if (current !== undefined && current.root !== owner.root) {
      if (!sameStorybookPackageOwner(current.root, owner.root)) {
        throw storybookBuildError(storybookDiagnostic(
          "link",
          `Package ${owner.name} resolved to two realpaths: ${current.root} via ${current.paths[0]} and ${owner.root} via ${path}`,
        ))
      }
      current.root = preferredStorybookPackageRoot(current.root, owner.root)
    }
    if (current === undefined) identities.set(owner.name, {paths: [path], root: owner.root})
    else current.paths.push(path)
  }
  const canonical = paths.map((path) => {
    const owner = readStorybookPackageOwner(path)
    if (owner === null) return path
    const identity = identities.get(owner.name)
    if (identity === undefined) return path
    try {
      return canonicalizeStorybookPackageFile(identity.root, path)
    } catch (error) {
      throw storybookBuildError(storybookDiagnostic(
        "link",
        error instanceof Error ? error.message : String(error),
        path,
      ))
    }
  })
  return Object.freeze([...new Set(canonical)].sort())
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
