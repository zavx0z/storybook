import {createHash, randomUUID} from "node:crypto"
import {
  closeSync,
  constants,
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
  generateStorybookAppliedRevisionLoaderSource,
  generateStorybookRevisionPayloadSource,
  STORYBOOK_REVISION_PAYLOAD_FILE,
  type StorybookGeneratedVariant,
  type StorybookGeneratedWidget,
} from "./generated-loader.ts"
import {createStorybookPackageCompilerPlugins} from "./compiler.ts"
import {
  beginStorybookBuildInputAttestation,
  createStorybookBuildInputFingerprintComputer,
  parseStorybookBuildInputFingerprint,
  sameStorybookBuildInputFingerprint,
  type StorybookBuildInputFingerprint,
} from "./build-input-fingerprint.ts"
import {
  parseStorybookBuildWorkerTransportEvent,
  type StorybookBuildPhase,
  type StorybookBuildPhaseEvent,
  type StorybookBuildPhaseListener,
  type StorybookBuildWorkerLifecycleListener,
} from "./build-phase.ts"
import {waitForStorybookOwnedChild} from "./child-process.ts"
import {
  canonicalizeStorybookPackageFile,
  preferredStorybookPackageRoot,
  readStorybookPackageOwner,
  sameStorybookPackageOwner,
} from "../src/shared/owner-identity.ts"
import {
  storybookBuildError,
  storybookDiagnostic,
  type StorybookPackageBuildDescriptor,
  type StorybookPackageRevisionResourceFile,
  type StorybookPackageRevisionBuilder,
} from "../sessions/package-session.ts"
import {
  createStorybookSharedBrowserExternalPlugin,
  validateStorybookSharedBrowserIdentity,
} from "./shared-module-identity.ts"
import type {StorybookSharedBrowserIdentity} from "./types/shared-module-identity.ts"

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
  onPhase?: StorybookBuildPhaseListener
  onWorkerLifecycle?: StorybookBuildWorkerLifecycleListener
  sharedBrowserIdentity?: StorybookSharedBrowserIdentity
  resolveSharedBrowserIdentity?(): Promise<StorybookSharedBrowserIdentity>
}>

/** Реальный builder result дополняет legacy session result полным cache evidence. */
export type StorybookFingerprintingPackageRevisionBuild = Readonly<
  Awaited<ReturnType<StorybookPackageRevisionBuilder>> & {
    inputFingerprint: StorybookBuildInputFingerprint
  }
>

/** Builder остаётся совместимым с session seam, но возвращает optional-to-session evidence. */
export type StorybookFingerprintingPackageRevisionBuilder = (
  input: StorybookFingerprintingPackageRevisionBuilderInput,
) => Promise<StorybookFingerprintingPackageRevisionBuild>

/** Per-operation observers привязываются scheduler context до вызова builder. */
export type StorybookFingerprintingPackageRevisionBuilderInput = Readonly<
  Parameters<StorybookPackageRevisionBuilder>[0] & {
    onPhase?: StorybookBuildPhaseListener
    onWorkerLifecycle?: StorybookBuildWorkerLifecycleListener
  }
>

/** Receipt restore вызывает verifier без знания private browser/protocol entry paths. */
export type StorybookBuildInputFingerprintVerifier = (
  value: unknown,
  descriptor: StorybookPackageBuildDescriptor,
) => StorybookBuildInputFingerprint | null

export type StorybookPackageBuildWorkerJob = Readonly<{
  input: Omit<
    StorybookFingerprintingPackageRevisionBuilderInput,
    "signal" | "onPhase" | "onWorkerLifecycle"
  >
  options: Readonly<{
    browserEntryPath: string
    runtimeProtocolPath: string
    sharedBrowserIdentity?: StorybookSharedBrowserIdentity
  }>
}>

export type StorybookPackageBuildWorkerResult = Readonly<{
  ok: true
  build: StorybookFingerprintingPackageRevisionBuild
}> | Readonly<{
  ok: false
  message: string
  diagnostics: readonly Readonly<{phase: string, message: string, path: string | null}>[]
}>

/** Создаёт реальный Bun browser builder для независимых `PackageSession`. */
export function createStorybookPackageRevisionBuilder(
  options: CreateStorybookPackageRevisionBuilderOptions = {},
): StorybookFingerprintingPackageRevisionBuilder {
  const browserEntryPath = realpathSync(options.browserEntryPath ?? fileURLToPath(
    new URL("../runtime/package-entry.ts", import.meta.url),
  ))
  const runtimeProtocolPath = realpathSync(options.runtimeProtocolPath ?? fileURLToPath(
    new URL("../runtime/runtime-protocol.ts", import.meta.url),
  ))
  const workerPath = realpathSync(options.workerPath ?? fileURLToPath(
    new URL("./package-build-worker.ts", import.meta.url),
  ))
  if (options.resolveCompilerPlugins !== undefined) {
    return async (input) => {
      const sharedBrowserIdentity = await resolveSharedBrowserIdentity(options)
      return buildStorybookPackageRevisionInProcess(input, {
        ...options,
        ...(sharedBrowserIdentity === undefined ? {} : {sharedBrowserIdentity}),
      })
    }
  }
  return async (input) => {
    const sharedBrowserIdentity = await resolveSharedBrowserIdentity(options)
    return runPackageBuildWorker(
      input,
      {
        browserEntryPath,
        runtimeProtocolPath,
        ...(sharedBrowserIdentity === undefined ? {} : {sharedBrowserIdentity}),
      },
      workerPath,
      options.onPhase,
      options.onWorkerLifecycle,
    )
  }
}

/**
Создаёт fail-closed verifier для persisted receipt evidence.

Unknown/old/missing evidence, изменённый descriptor, source inventory, config,
toolchain либо ABI возвращают `null`: session сохраняет lastWorking artifact, но
не объявляет его cache hit и заказывает cold build. Compiler child не запускается.
*/
export function createStorybookBuildInputFingerprintVerifier(
  options: Pick<
    CreateStorybookPackageRevisionBuilderOptions,
    "browserEntryPath" | "runtimeProtocolPath" | "sharedBrowserIdentity"
  > = {},
): StorybookBuildInputFingerprintVerifier {
  const browserEntryPath = realpathSync(options.browserEntryPath ?? fileURLToPath(
    new URL("../runtime/package-entry.ts", import.meta.url),
  ))
  const runtimeProtocolPath = realpathSync(options.runtimeProtocolPath ?? fileURLToPath(
    new URL("../runtime/runtime-protocol.ts", import.meta.url),
  ))
  const compute = createStorybookBuildInputFingerprintComputer()
  return (value, descriptor): StorybookBuildInputFingerprint | null => {
    const persisted = parseStorybookBuildInputFingerprint(value)
    if (persisted === null) return null
    try {
      const current = compute({
        descriptor,
        browserEntryPath,
        runtimeProtocolPath,
        ...(options.sharedBrowserIdentity === undefined
          ? {}
          : {sharedBrowserIdentity: validateStorybookSharedBrowserIdentity(options.sharedBrowserIdentity)}),
        additionalFilePaths: persisted.files.map(({path}) => path),
        resolutionDirectories: persisted.resolutionDirectories,
      })
      return sameStorybookBuildInputFingerprint(persisted, current) ? current : null
    } catch {
      return null
    }
  }
}

/** Выполняет сборку внутри isolated package worker либо focused test seam. */
export async function buildStorybookPackageRevisionInProcess(
  input: StorybookFingerprintingPackageRevisionBuilderInput,
  options: CreateStorybookPackageRevisionBuilderOptions = {},
): Promise<StorybookFingerprintingPackageRevisionBuild> {
  input.signal.throwIfAborted()
  const browserEntryPath = realpathSync(options.browserEntryPath ?? fileURLToPath(
    new URL("../runtime/package-entry.ts", import.meta.url),
  ))
  const runtimeProtocolPath = realpathSync(options.runtimeProtocolPath ?? fileURLToPath(
    new URL("../runtime/runtime-protocol.ts", import.meta.url),
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
  const sharedBrowserIdentity = options.sharedBrowserIdentity === undefined
    ? undefined
    : validateStorybookSharedBrowserIdentity(options.sharedBrowserIdentity)

  return (async (): Promise<StorybookFingerprintingPackageRevisionBuild> => {
    const {descriptor, candidateRevision, revisionUrl, stagingDirectory} = input
    const sharedModuleEpoch = sharedBrowserIdentity?.epoch ?? isolatedStorybookSharedModuleEpoch(
      descriptor.packageId,
      candidateRevision,
    )
    input.signal.throwIfAborted()
    mkdirSync(stagingDirectory, {recursive: true})
    const onPhase = input.onPhase ?? options.onPhase
    emitPhase(onPhase, "fingerprint", "started")
    const attestation = await beginStorybookBuildInputAttestation({
      descriptor,
      browserEntryPath,
      runtimeProtocolPath,
      stagingDirectory,
      ...(sharedBrowserIdentity === undefined ? {} : {sharedBrowserIdentity}),
    })
    try {
    emitPhase(onPhase, "resources", "started")
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
      if (resource.derivedContent !== undefined) {
        if (attestedBytes === null) throw new Error(`Derived resource has no attested source: ${resource.targetPath}`)
        writeFileSync(target, resource.derivedContent)
      }
      // macOS copyFileSync может сообщать change исходника без изменения его байтов.
      // Записываем проверенный снимок, сохраняя строгий guard реальных изменений.
      else if (attestedBytes === null) writeFileSync(target, readAttestedRevisionResource({
        ...resource,
        sourceRoot: resource.sourceRoot ?? dirname(resource.sourcePath),
      }))
      else writeFileSync(target, attestedBytes)
    }
    emitPhase(onPhase, "resources", "completed")
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
    input.signal.throwIfAborted()
    emitPhase(onPhase, "exports", "started")
    validateModuleExports(descriptor)
    emitPhase(onPhase, "exports", "completed")
    const plugins = Object.freeze([...(await resolvePlugins(compilerInput))])
    validatePlugins(plugins)

    const loaderPath = join(stagingDirectory, "generated-loaders.ts")
    const entryPath = join(stagingDirectory, "entry.ts")
    const payloadPath = join(stagingDirectory, "revision-payload.ts")
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
    await Bun.write(entryPath, sharedBrowserIdentity === undefined ? [
      `import {startExternalStorybookPackage} from ${JSON.stringify(browserEntryPath)}`,
      "import {",
      "  loadStorybookPackageRuntime,",
      "  STORYBOOK_PACKAGE_STORY_LOADERS,",
      "  STORYBOOK_PACKAGE_WIDGET_LOADERS,",
      "  storybookRevisionUrl,",
      "} from \"./generated-loaders.ts\"",
      "",
      generateStorybookAppliedRevisionLoaderSource(descriptor.packageId),
      "await startExternalStorybookPackage({",
      `  packageId: ${JSON.stringify(descriptor.packageId)},`,
      `  candidateRevision: ${JSON.stringify(candidateRevision)},`,
      `  sharedModuleEpoch: ${JSON.stringify(sharedModuleEpoch)},`,
      `  graphSnapshot: ${JSON.stringify(descriptor.graphSnapshot)},`,
      "  revisionUrl: storybookRevisionUrl,",
      "  loadRuntime: loadStorybookPackageRuntime,",
      "  storyLoaders: STORYBOOK_PACKAGE_STORY_LOADERS,",
      "  widgetLoaders: STORYBOOK_PACKAGE_WIDGET_LOADERS,",
      "  environment: {loadAppliedRevision},",
      "})",
      "",
    ].join("\n") : [
      `import {startExternalStorybookPage} from ${JSON.stringify(sharedBrowserIdentity.packageEntryUrl)}`,
      `import {STORYBOOK_APPLIED_REVISION} from "./revision-payload.ts"`,
      "",
      "await startExternalStorybookPage({",
      "  initialPayload: STORYBOOK_APPLIED_REVISION,",
      `  sharedModuleEpoch: ${JSON.stringify(sharedModuleEpoch)},`,
      `  hostModuleEpoch: ${JSON.stringify(sharedBrowserIdentity.hostModuleEpoch)},`,
      "})",
      "",
    ].join("\n"))
    await Bun.write(payloadPath, generateStorybookRevisionPayloadSource({
      packageId: descriptor.packageId,
      candidateRevision,
      sharedModuleEpoch,
      ...(sharedBrowserIdentity === undefined
        ? {}
        : {hostModuleEpoch: sharedBrowserIdentity.hostModuleEpoch}),
      graphSnapshot: descriptor.graphSnapshot,
    }))

    input.signal.throwIfAborted()
    emitPhase(onPhase, "bundle", "started")
    const result = await Bun.build({
      entrypoints: [entryPath, payloadPath],
      outdir: stagingDirectory,
      naming: {
        entry: "[name].[ext]",
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
      plugins: [
        ...(sharedBrowserIdentity === undefined
          ? []
          : [createStorybookSharedBrowserExternalPlugin(sharedBrowserIdentity)]),
        ...plugins,
      ],
      metafile: true,
      throw: false,
    })
    if (!result.success) throw buildLogsError("compile", result.logs)
    emitPhase(onPhase, "bundle", "completed")
    const metafile = result.metafile
    if (metafile === undefined) throw storybookBuildError(storybookDiagnostic("link", "Bun emitted no package metafile"))
    validateBundledModuleExports(descriptor, metafile.outputs, descriptor.projectRoot)
    const stagingPrefix = `${realpathSync(stagingDirectory)}${sep}`
    let dependencyRealpaths = canonicalizeStorybookPackageIdentities(canonicalBuildInputs(
      metafile.inputs,
      descriptor.projectRoot,
    ).filter((path) => !path.startsWith(stagingPrefix)))
    if (descriptor.runtime !== null) {
      const protocolPlugins = Object.freeze([...(await resolvePlugins(compilerInput))])
      validatePlugins(protocolPlugins)
      const protocolInputs = await validateRuntimeProtocol(
        descriptor,
        runtimeProtocolPath,
        stagingDirectory,
        protocolPlugins,
        input.signal,
        input.protocolTimeoutMs,
        onPhase,
      )
      dependencyRealpaths = canonicalizeStorybookPackageIdentities([
        ...dependencyRealpaths,
        ...protocolInputs,
      ])
    }
    validateConsumerBoundary(dependencyRealpaths, descriptor, stagingDirectory)
    if (sharedBrowserIdentity !== undefined) {
      validateStorybookSharedBrowserIdentity(sharedBrowserIdentity)
    }
    const entryOutput = result.outputs.find((output) =>
      output.kind === "entry-point" && basename(output.path) === "entry.js")
    if (entryOutput === undefined) {
      throw storybookBuildError(storybookDiagnostic("link", "Package build emitted no entry point"))
    }
    if (!result.outputs.some((output) =>
      output.kind === "entry-point" && basename(output.path) === STORYBOOK_REVISION_PAYLOAD_FILE)) {
      throw storybookBuildError(storybookDiagnostic("link", "Package build emitted no revision payload"))
    }
    const entryRelativePath = relative(stagingDirectory, entryOutput.path)
    const moduleGraphRevision = await buildRevisionDigest(
      descriptor,
      dependencyRealpaths,
      result.outputs,
      metafile.inputs,
    )
    rmSync(join(stagingDirectory, ".protocol"), {recursive: true, force: true})
    for (const path of [loaderPath, entryPath, payloadPath, join(stagingDirectory, "validate-runtime.ts")]) {
      rmSync(path, {force: true})
    }
    const inputFingerprint = await attestation.complete(dependencyRealpaths)
    emitPhase(onPhase, "fingerprint", "completed")
    return Object.freeze({
      moduleGraphRevision,
      dependencyRealpaths,
      entryRelativePath,
      inputFingerprint,
    })
    } finally {
      attestation.dispose()
    }
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
  input: StorybookFingerprintingPackageRevisionBuilderInput,
  options: Readonly<{
    browserEntryPath: string
    runtimeProtocolPath: string
    sharedBrowserIdentity?: StorybookSharedBrowserIdentity
  }>,
  workerPath: string,
  onPhase?: StorybookBuildPhaseListener,
  onWorkerLifecycle?: StorybookBuildWorkerLifecycleListener,
): Promise<StorybookFingerprintingPackageRevisionBuild> {
  input.signal.throwIfAborted()
  mkdirSync(input.stagingDirectory, {recursive: true})
  const nonce = randomUUID()
  const startedAt = new Date().toISOString()
  const jobPath = join(input.stagingDirectory, `.build-job-${nonce}.json`)
  const resultPath = join(input.stagingDirectory, `.build-result-${nonce}.json`)
  const {
    signal: _signal,
    onPhase: inputOnPhase,
    onWorkerLifecycle: inputOnWorkerLifecycle,
    ...serializableInput
  } = input
  const phaseListener = inputOnPhase ?? onPhase
  const lifecycleListener = inputOnWorkerLifecycle ?? onWorkerLifecycle
  const job: StorybookPackageBuildWorkerJob = Object.freeze({
    input: serializableInput,
    options,
  })
  await Bun.write(jobPath, `${JSON.stringify(job)}\n`)
  const child = Bun.spawn([process.execPath, workerPath, jobPath, resultPath], {
    cwd: input.descriptor.projectRoot,
    env: {
      ...Bun.env,
      STORYBOOK_PACKAGE_BUILD_WORKER: "1",
      STORYBOOK_PACKAGE_BUILD_WORKER_ID: nonce,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  })
  let workerStarted = false
  const workerPid = child.pid
  try {
    const {exitCode, stderr} = await waitForStorybookOwnedChild({
      child,
      signal: input.signal,
      timeoutMs: input.compileTimeoutMs,
      label: "Storybook package compile",
      processGroup: {leaderPid: workerPid},
      hardKillDelayMs: 1_000,
      readStdout: async (stream) => readWorkerEventStream(stream, {
        workerId: nonce,
        pid: workerPid,
        onReady: () => {
          if (workerStarted) return
          workerStarted = true
          notifyWorkerLifecycle(lifecycleListener, {
            state: "started",
            workerId: nonce,
            pid: workerPid,
            startedAt,
          })
        },
        ...(phaseListener === undefined ? {} : {onPhase: phaseListener}),
      }),
    })
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
    const exitCode = await child.exited.catch(() => -1)
    if (workerStarted) {
      notifyWorkerLifecycle(lifecycleListener, {
        state: "exited",
        workerId: nonce,
        pid: workerPid,
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode,
      })
    }
    rmSync(jobPath, {force: true})
    rmSync(resultPath, {force: true})
  }
}

async function resolveSharedBrowserIdentity(
  options: CreateStorybookPackageRevisionBuilderOptions,
): Promise<StorybookSharedBrowserIdentity | undefined> {
  if (options.sharedBrowserIdentity !== undefined) {
    return validateStorybookSharedBrowserIdentity(options.sharedBrowserIdentity)
  }
  if (options.resolveSharedBrowserIdentity === undefined) return undefined
  return validateStorybookSharedBrowserIdentity(await options.resolveSharedBrowserIdentity())
}

/** Создаёт несовместимую между кандидатами эпоху для unshared transitional build. */
export function isolatedStorybookSharedModuleEpoch(packageId: string, candidateRevision: string): string {
  return createHash("sha256")
    .update(`isolated\0${packageId}\0${candidateRevision}`)
    .digest("hex")
}

/**
Дренирует bounded worker stdout и передаёт phase events сразу при получении строки.

Первый принятый lifecycle event обязан подтвердить exact launch nonce и PID.
Malformed/лишние строки игнорируются и не получают права привязать scheduler к PID.
*/
async function readWorkerEventStream(
  stream: unknown,
  input: Readonly<{
    workerId: string
    pid: number
    onReady(): void
    onPhase?: StorybookBuildPhaseListener
  }>,
): Promise<string> {
  if (stream === null || stream === undefined || typeof stream === "number") return ""
  const reader = (stream as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  let consumed = 0
  let ready = false
  const limit = 64 * 1024
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (consumed >= limit) continue
      consumed += next.value.byteLength
      if (consumed > limit) {
        buffered = ""
        continue
      }
      buffered += decoder.decode(next.value, {stream: true})
      let newline = buffered.indexOf("\n")
      while (newline >= 0) {
        ready = consumeWorkerEventLine(buffered.slice(0, newline), input, ready)
        buffered = buffered.slice(newline + 1)
        newline = buffered.indexOf("\n")
      }
    }
    buffered += decoder.decode()
    if (buffered.length > 0) consumeWorkerEventLine(buffered, input, ready)
  } catch (error) {
    await reader.cancel(error).catch(() => {})
    throw error
  }
  return ""
}

/** Проверяет одну JSONL запись и не допускает подмену exact worker handshake. */
function consumeWorkerEventLine(
  line: string,
  input: Readonly<{
    workerId: string
    pid: number
    onReady(): void
    onPhase?: StorybookBuildPhaseListener
  }>,
  ready: boolean,
): boolean {
  if (line.length === 0 || line.length > 8 * 1024) return ready
  let decoded: unknown
  try {
    decoded = JSON.parse(line)
  } catch {
    return ready
  }
  const event = parseStorybookBuildWorkerTransportEvent(decoded)
  if (event === null) return ready
  if (event.kind === "ready") {
    if (!ready && event.workerId === input.workerId && event.pid === input.pid) {
      input.onReady()
      return true
    }
    return ready
  }
  if (ready) notifyPhase(input.onPhase, event.event)
  return ready
}

/** Создаёт timestamped phase boundary и изолирует build от observer exception. */
function emitPhase(
  listener: StorybookBuildPhaseListener | undefined,
  phase: StorybookBuildPhase,
  state: StorybookBuildPhaseEvent["state"],
): void {
  notifyPhase(listener, Object.freeze({phase, state, at: new Date().toISOString()}))
}

/** Observer не получает права ломать либо менять результат compiler operation. */
function notifyPhase(
  listener: StorybookBuildPhaseListener | undefined,
  event: StorybookBuildPhaseEvent,
): void {
  try {
    listener?.(event)
  } catch {
    // Scheduler observability не влияет на корректность compiler.
  }
}

/** Lifecycle observer изолирован от exact worker ownership и cancellation. */
function notifyWorkerLifecycle(
  listener: StorybookBuildWorkerLifecycleListener | undefined,
  event: Parameters<StorybookBuildWorkerLifecycleListener>[0],
): void {
  try {
    listener?.(event)
  } catch {
    // Resource sampling не может менять worker lifecycle.
  }
}

function isWorkerDiagnosticPhase(
  value: string,
): value is Parameters<typeof storybookDiagnostic>[0] {
  return ["resolve", "validate", "compile", "link", "protocol", "publish", "watch", "activation", "timeout"]
    .includes(value)
}

function validateModuleExports(
  descriptor: StorybookPackageBuildDescriptor,
): void {
  const modules = [
    ...(descriptor.runtime === null ? [] : [descriptor.runtime]),
    ...descriptor.variants.map(({module}) => module),
    ...descriptor.widgetModules.map(({module}) => module),
  ]
  if (modules.length === 0) return
  for (const module of modules) validateScannedExport(module.path, module.export)
}

/**
Проверяет реальные namespace exports динамических chunks по main build metafile.

В отличие от source scan эта проверка видит broken named re-export после resolver
и tree shaking, но не создаёт второй Bun build и не исполняет author modules.
*/
function validateBundledModuleExports(
  descriptor: StorybookPackageBuildDescriptor,
  outputs: Readonly<Record<string, unknown>>,
  projectRoot: string,
): void {
  const modules = [
    ...(descriptor.runtime === null ? [] : [descriptor.runtime]),
    ...descriptor.variants.map(({module}) => module),
    ...descriptor.widgetModules.map(({module}) => module),
  ]
  const exportsByEntry = new Map<string, readonly string[]>()
  for (const output of Object.values(outputs)) {
    if (output === null || typeof output !== "object") continue
    const record = output as Record<string, unknown>
    if (typeof record.entryPoint !== "string" || !Array.isArray(record.exports) ||
      !record.exports.every((value) => typeof value === "string")) continue
    const entry = canonicalBuildInputs({[record.entryPoint]: {}}, projectRoot)[0]
    if (entry !== undefined) exportsByEntry.set(entry, Object.freeze([...record.exports] as string[]))
  }
  for (const module of modules) {
    const path = stableBuildInputPath(module.path)
    const exports = exportsByEntry.get(path)
    if (exports === undefined || !exports.includes(module.export)) {
      throw storybookBuildError(storybookDiagnostic(
        "validate",
        `Bundled module does not export ${module.export}`,
        module.path,
      ))
    }
  }
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

async function validateRuntimeProtocol(
  descriptor: StorybookPackageBuildDescriptor,
  runtimeProtocolPath: string,
  stagingDirectory: string,
  plugins: readonly Bun.BunPlugin[],
  signal: AbortSignal,
  timeoutMs: number,
  onPhase?: StorybookBuildPhaseListener,
): Promise<readonly string[]> {
  const runtime = descriptor.runtime
  if (runtime === null) return Object.freeze([])
  const validationPath = join(stagingDirectory, "validate-runtime.ts")
  await Bun.write(validationPath, [
    `import {validateStorybookRuntimeAdapter} from ${JSON.stringify(runtimeProtocolPath)}`,
    `import {${runtime.export} as candidate} from ${JSON.stringify(runtime.path)}`,
    "validateStorybookRuntimeAdapter(candidate)",
    "",
  ].join("\n"))
  const outputDirectory = join(stagingDirectory, ".protocol")
  emitPhase(onPhase, "protocol-build", "started")
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
    metafile: true,
    throw: false,
  })
  if (!build.success) throw buildLogsError("protocol", build.logs)
  emitPhase(onPhase, "protocol-build", "completed")
  if (build.metafile === undefined) {
    throw storybookBuildError(storybookDiagnostic("protocol", "Runtime protocol build emitted no metafile", runtime.path))
  }
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
  emitPhase(onPhase, "protocol-run", "started")
  const {exitCode, stdout, stderr} = await waitForStorybookOwnedChild({
    child,
    signal,
    timeoutMs,
    label: "Storybook runtime protocol validation",
  })
  if (exitCode !== 0) {
    const message = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n") ||
      `Runtime protocol validation exited ${exitCode}`
    throw storybookBuildError(storybookDiagnostic("protocol", message, runtime.path))
  }
  emitPhase(onPhase, "protocol-run", "completed")
  const stagingPrefix = `${realpathSync(stagingDirectory)}${sep}`
  return canonicalBuildInputs(build.metafile.inputs, descriptor.projectRoot)
    .filter((path) => !path.startsWith(stagingPrefix))
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
