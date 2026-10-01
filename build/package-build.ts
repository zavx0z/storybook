import BuildInputs, {type BuildInputFingerprint as StorybookBuildInputFingerprint} from "@build/inputs"
import {checkStorybookPackageConformance, scenarioVerification} from "./package-conformance"
import {type StorybookPackageStandard} from "../sessions/package-standard"
import {createHash} from "node:crypto"
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
import {readScenario, ScenarioAuthoringError, supportsScenarioPreview, type ReadScenarioOutput} from "@storybook/app-old/scenarios"
import {
  generateStorybookLoaderSource,
  generateStorybookJsxModules,
  generateStorybookAppliedRevisionLoaderSource,
  generateStorybookRevisionPayloadSource,
  STORYBOOK_REVISION_PAYLOAD_FILE,
  type StorybookGeneratedScenario,
} from "./generated-loader.ts"
import {createStorybookPackageCompilerPlugins} from "./compiler.ts"
import {ensureGeneratedJsxProtocol} from "./src/generated-jsx-protocol.ts"
import {
  beginStorybookBuildInputAttestation,
  createStorybookBuildInputFingerprintComputer,
} from "./build-input-fingerprint.ts"
import {
  parseStorybookBuildWorkerTransportEvent,
  type StorybookBuildPhase,
  type StorybookBuildPhaseEvent,
  type StorybookBuildPhaseListener,
  type StorybookBuildWorkerLifecycleListener,
} from "./build-phase.ts"
import runBuildWorker from "@build/worker"
import {
  canonicalizeStorybookPackageFile,
  preferredStorybookPackageRoot,
  readStorybookPackageOwner,
  sameStorybookPackageOwner,
} from "./src/owner-identity.ts"
import {
  storybookBuildError,
  storybookDiagnostic,
  type StorybookPackageBuildDescriptor,
  type StorybookPackageDiagnostic,
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
    generatedSourceRoot?: string
  }>,
) => Promise<readonly Bun.BunPlugin[]>

/**
Композиция передаёт один tool owner для компилятора, fingerprint и worker.

@property toolRoot - Корень исполняемой сборочной системы; передаётся в worker каноническим путём.

@property [browserEntryPath] - Явный entrypoint; по умолчанию `runtime/package-entry.ts` выбранного tool owner.

@property [workerPath] - Явный worker; по умолчанию `build/package-build-worker.ts` того же владельца.

@property [resolveCompilerPlugins] - Внедрённый compiler resolver для исполнения в текущем процессе.

@property [onPhase] - Получатель этапов этой сборки.

@property [onWorkerLifecycle] - Получатель начала и завершения точного дочернего процесса.

@property [sharedBrowserIdentity] - Проверенная идентичность общей платформы.

@property [resolveSharedBrowserIdentity] - Получает актуальную общую платформу перед запуском работы.
*/
export type CreateStorybookPackageRevisionBuilderOptions = Readonly<{
  toolRoot: string
  browserEntryPath?: string
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
    toolRoot: string
    browserEntryPath: string
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
  options: CreateStorybookPackageRevisionBuilderOptions,
): StorybookFingerprintingPackageRevisionBuilder {
  const toolRoot = realpathSync(options.toolRoot)
  const browserEntryPath = realpathSync(options.browserEntryPath ?? join(toolRoot, "runtime/package-entry.ts"))
  const workerPath = realpathSync(options.workerPath ?? join(toolRoot, "build/package-build-worker.ts"))
  if (options.resolveCompilerPlugins !== undefined) {
    return async (input) => {
      const sharedBrowserIdentity = await resolveSharedBrowserIdentity(options)
      return buildStorybookPackageRevisionInProcess(input, {
        ...options,
        toolRoot,
        browserEntryPath,
        ...(sharedBrowserIdentity === undefined ? {} : {sharedBrowserIdentity}),
      })
    }
  }
  return async (input) => {
    const sharedBrowserIdentity = await resolveSharedBrowserIdentity(options)
    return runPackageBuildWorker(
      input,
      {
        toolRoot,
        browserEntryPath,
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
    "toolRoot" | "browserEntryPath" | "sharedBrowserIdentity"
  >,
): StorybookBuildInputFingerprintVerifier {
  const toolRoot = realpathSync(options.toolRoot)
  const browserEntryPath = realpathSync(options.browserEntryPath ?? join(toolRoot, "runtime/package-entry.ts"))
  const compute = createStorybookBuildInputFingerprintComputer()
  return (value, descriptor): StorybookBuildInputFingerprint | null => {
    const persisted = BuildInputs.parse(value)
    if (persisted === null) return null
    try {
      const current = compute({
        toolRoot,
        descriptor,
        browserEntryPath,
        ...(options.sharedBrowserIdentity === undefined
          ? {}
          : {sharedBrowserIdentity: validateStorybookSharedBrowserIdentity(options.sharedBrowserIdentity)}),
        additionalFilePaths: persisted.files.map(({path}) => path),
        resolutionDirectories: persisted.resolutionDirectories,
      })
      return BuildInputs.same(persisted, current) ? current : null
    } catch {
      return null
    }
  }
}

/** Выполняет сборку внутри isolated package worker либо focused test seam. */
export async function buildStorybookPackageRevisionInProcess(
  input: StorybookFingerprintingPackageRevisionBuilderInput,
  options: CreateStorybookPackageRevisionBuilderOptions,
): Promise<StorybookFingerprintingPackageRevisionBuild> {
  input.signal.throwIfAborted()
  const toolRoot = realpathSync(options.toolRoot)
  const browserEntryPath = realpathSync(options.browserEntryPath ?? join(toolRoot, "runtime/package-entry.ts"))
  const resolvePlugins = options.resolveCompilerPlugins ?? (async ({
    packageRoot,
    projectRoot,
    sourcePaths,
    generatedSourceRoot,
  }) => createStorybookPackageCompilerPlugins({
    toolRoot,
    packageRoot,
    projectRoot,
    moduleSourcePaths: sourcePaths,
    ...(generatedSourceRoot === undefined ? {} : {generatedSourceRoot}),
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
      toolRoot,
      descriptor,
      browserEntryPath,
      stagingDirectory,
      ...(sharedBrowserIdentity === undefined ? {} : {sharedBrowserIdentity}),
    })
    try {
    emitPhase(onPhase, "verification", "started")
    const report = await checkStorybookPackageConformance(descriptor.packageRoot, input.signal)
    const verification = scenarioVerification(report)
    if (input.standard === "strict" && verification.status !== "passed") throw storybookBuildError(verification.diagnostics)
    writeFileSync(join(stagingDirectory, "verification.json"), JSON.stringify(report))
    emitPhase(onPhase, "verification", "completed")
    const warnings: StorybookPackageDiagnostic[] = [...verification.diagnostics]
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
    let scenarios = await prepareStorybookScenarios(descriptor, input.signal, (nodeId, result) => {
      const directory = join(stagingDirectory, "scenarios")
      mkdirSync(directory, {recursive: true})
      writeFileSync(join(directory, `${encodeURIComponent(nodeId)}.json`), JSON.stringify(result))
    }, {standard: input.standard ?? "transition", warnings})
    const sourcePaths = Object.freeze(scenarios.flatMap(scenario => scenario.kind === "component" ? [scenario.module.path] : []))
    const generatedSourceRoot = join(stagingDirectory, "scenario-jsx")
    const jsxModules = generateStorybookJsxModules(scenarios)
    const componentModules = scenarios.flatMap((scenario, index) => scenario.kind === "component" && scenario.module.source
      ? [{path: `./scenario-jsx/component-${index}.tsx`, source: scenario.module.source}] : [])
    if (jsxModules.length || componentModules.length) {
      mkdirSync(generatedSourceRoot, {recursive: true})
      ensureGeneratedJsxProtocol(generatedSourceRoot, toolRoot)
      await Bun.write(join(generatedSourceRoot, "tsconfig.json"), JSON.stringify({
        compilerOptions: {target: "ESNext", module: "ESNext", moduleResolution: "Bundler",
          jsx: "react-jsx", jsxImportSource: "@zavx0z/jsx", noEmit: true, allowImportingTsExtensions: true, strict: true, skipLibCheck: true},
        include: ["*.tsx"],
      }))
      for (const module of [...jsxModules, ...componentModules]) await Bun.write(join(stagingDirectory, module.path), module.source)
    }
    scenarios = scenarios.map((scenario, index) => scenario.kind === "component" && scenario.module.source
      ? {...scenario, module: {path: join(generatedSourceRoot, `component-${index}.tsx`), export: scenario.module.export}} : scenario)
    const compilerInput = Object.freeze({
      ...(jsxModules.length || componentModules.length ? {generatedSourceRoot} : {}),
      packageRoot: descriptor.packageRoot,
      projectRoot: descriptor.projectRoot,
      sourcePaths,
    })
    input.signal.throwIfAborted()
    emitPhase(onPhase, "exports", "started")
    validateModuleExports(descriptor, scenarios)
    emitPhase(onPhase, "exports", "completed")
    const plugins = Object.freeze([...(await resolvePlugins(compilerInput))])
    validatePlugins(plugins)

    const loaderPath = join(stagingDirectory, "generated-loaders.ts")
    const entryPath = join(stagingDirectory, "entry.ts")
    const payloadPath = join(stagingDirectory, "revision-payload.ts")
    const graphPath = join(stagingDirectory, "package-graph.json")
    await Bun.write(graphPath, `${JSON.stringify(descriptor.graphSnapshot)}\n`)
    await Bun.write(loaderPath, generateStorybookLoaderSource({
      revisionUrl,
      scenarios,
    }))
    await Bun.write(entryPath, sharedBrowserIdentity === undefined ? [
      `import {startExternalStorybookPackage} from ${JSON.stringify(browserEntryPath)}`,
      "import {",
      "  STORYBOOK_PACKAGE_SCENARIO_LOADERS,",
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
      "  scenarioLoaders: STORYBOOK_PACKAGE_SCENARIO_LOADERS,",
      "  environment: {loadAppliedRevision},",
      "})",
      "",
    ].join("\n") : 'export {STORYBOOK_APPLIED_REVISION} from "./revision-payload.ts"\n')
    await Bun.write(payloadPath, generateStorybookRevisionPayloadSource({
      packageId: descriptor.packageId,
      candidateRevision,
      sharedModuleEpoch,
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
    validateBundledModuleExports(descriptor, scenarios, metafile.outputs, descriptor.projectRoot)
    const stagingPrefix = `${realpathSync(stagingDirectory)}${sep}`
    let dependencyRealpaths = canonicalizeStorybookPackageIdentities(canonicalBuildInputs(
      metafile.inputs,
      descriptor.projectRoot,
    ).filter((path) => !path.startsWith(stagingPrefix)).concat(
      (descriptor.scenarioSpecs ?? []).flatMap(({sourcePaths}) => sourcePaths.map(stableBuildInputPath)),
    ))
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
    for (const path of [loaderPath, entryPath, payloadPath]) {
      rmSync(path, {force: true})
    }
    const inputFingerprint = await attestation.complete(dependencyRealpaths)
    emitPhase(onPhase, "fingerprint", "completed")
    return Object.freeze({
      moduleGraphRevision,
      ...(sharedBrowserIdentity === undefined ? {} : {sharedModuleEpoch}),
      dependencyRealpaths,
      entryRelativePath,
      inputFingerprint,
      verification,
      warnings,
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

/** Передаёт пакетное задание исполнителю и проверяет предметный результат после очистки worker. */
async function runPackageBuildWorker(
  input: StorybookFingerprintingPackageRevisionBuilderInput,
  options: Readonly<{
    toolRoot: string
    browserEntryPath: string
    sharedBrowserIdentity?: StorybookSharedBrowserIdentity
  }>,
  workerPath: string,
  onPhase?: StorybookBuildPhaseListener,
  onWorkerLifecycle?: StorybookBuildWorkerLifecycleListener,
): Promise<StorybookFingerprintingPackageRevisionBuild> {
  const {
    signal,
    onPhase: inputOnPhase,
    onWorkerLifecycle: inputOnWorkerLifecycle,
    ...serializableInput
  } = input
  const phaseListener = inputOnPhase ?? onPhase
  const lifecycleListener = inputOnWorkerLifecycle ?? onWorkerLifecycle
  const job: StorybookPackageBuildWorkerJob = Object.freeze({input: serializableInput, options})
  const execution = await runBuildWorker({
    entryPath: workerPath,
    cwd: input.descriptor.projectRoot,
    temporaryRoot: input.stagingDirectory,
    createJob: () => job,
    signal,
    timeoutMs: input.compileTimeoutMs,
    label: "Storybook package compile",
    parseEvent: parseStorybookBuildWorkerTransportEvent,
    streamMode: "tolerant",
    ...(phaseListener === undefined ? {} : {onProgress: phaseListener}),
    ...(lifecycleListener === undefined ? {} : {onLifecycle: lifecycleListener}),
  })
  if (execution.result === undefined) {
    throw storybookBuildError(storybookDiagnostic(
      "compile",
      execution.stderr.trim() || `Storybook package build worker exited ${execution.exitCode} without a result`,
    ))
  }
  const result = execution.result as StorybookPackageBuildWorkerResult
  if (result.ok) return result.build
  const diagnostics = result.diagnostics.flatMap((diagnostic) =>
    isWorkerDiagnosticPhase(diagnostic.phase)
      ? [storybookDiagnostic(diagnostic.phase, diagnostic.message, diagnostic.path)]
      : [])
  throw storybookBuildError(diagnostics.length > 0
    ? diagnostics
    : storybookDiagnostic("compile", result.message))
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

function isWorkerDiagnosticPhase(
  value: string,
): value is Parameters<typeof storybookDiagnostic>[0] {
  return ["resolve", "validate", "compile", "link", "protocol", "publish", "activation", "timeout"]
    .includes(value)
}

/**
Подготавливает однозначные preview-сценарии текущей package revision.

Статический probe не исполняет Bun Test. Собственные сценарии выполняются здесь один раз; нормативные сценарии
проверяются отдельно тем же App. Технический отказ
блокирует оба режима. Нарушение авторства переходного пакета даёт предупреждение
и отсутствие preview; строгий пакет требует поддержанного представления.
Полный отчёт сохраняется отдельно от браузерного модуля.
*/
export async function prepareStorybookScenarios(
  descriptor: StorybookPackageBuildDescriptor,
  signal: AbortSignal,
  onPrepared?: (nodeId: string, result: ReadScenarioOutput) => void,
  policy: Readonly<{standard: StorybookPackageStandard, warnings: StorybookPackageDiagnostic[]}> = {standard: "strict", warnings: []},
): Promise<readonly StorybookGeneratedScenario[]> {
  const prepared: StorybookGeneratedScenario[] = []
  const read = (path: string) => readScenario({path, signal})
  const authoring = (message: string, path: string): void => {
    if (policy.standard === "strict") throw storybookBuildError(storybookDiagnostic("validate", message, path))
    policy.warnings.push(storybookDiagnostic("validate", message, path))
  }
  const verify = (report: ReadScenarioOutput): void => {
    assertScenarioExecution(report)
    const result = scenarioVerification(report)
    if (result.status !== "passed") authoring(result.diagnostics.map(item => item.message).join("\n"), report.path)
  }
  for (const spec of descriptor.scenarioSpecs ?? []) {
    if (spec.sourcePaths.length !== 1) {
      if (spec.sourcePaths.length) authoring("Нет однозначного исполняемого preview: указан более чем один сценарий", spec.sourcePaths[0]!)
      continue
    }
    const supported: string[] = []
    let structuralReport = false
    for (const path of spec.sourcePaths) {
      signal.throwIfAborted()
      try {
        if (await supportsScenarioPreview({path})) supported.push(path)
        else {
          const report = await read(path)
          verify(report)
          onPrepared?.(spec.nodeId, report)
          structuralReport = report.source.subject === null
        }
      } catch (error) {
        if (!(error instanceof ScenarioAuthoringError)) throw error
        if (policy.standard === "strict") throw error
        // Нарушение оформления не скрывает ошибку исполнения того же сценария.
        const report = await read(path)
        verify(report)
        onPrepared?.(spec.nodeId, report)
        authoring(error.message, path)
      }
    }
    if (supported.length !== 1) {
      if (spec.sourcePaths.length && !(structuralReport && spec.sourcePaths.length === 1)) {
        authoring("Нет однозначного исполняемого preview: исправьте оформление сценария", spec.sourcePaths[0]!)
      }
      continue
    }
    signal.throwIfAborted()
    const result = await read(supported[0]!)
    verify(result)
    onPrepared?.(spec.nodeId, result)
    const violations = result.validation.checks.filter(check => check.status === "failed" && check.rule !== "execution")
    if (violations.length) {
      continue
    }
    if (result.preview === undefined) {
      authoring(`Не удалось подготовить представление распознанного сценария ${supported[0]}: проверьте наблюдённый вызов и представимость его аргументов`, supported[0]!)
      continue
    }
    const preview = result.preview
    prepared.push(Object.freeze(preview.kind === "function" ? {
      nodeId: spec.nodeId, ...preview,
    } : {
      nodeId: spec.nodeId, kind: "component" as const,
      module: Object.freeze({
        path: stableBuildInputPath(preview.module.path),
        export: preview.module.export,
        ...(preview.module.source ? {source: preview.module.source} : {}),
      }),
      variants: preview.variants,
    }))
  }
  return Object.freeze(prepared)
}

/** Исполнение остаётся обязательным в обоих режимах стандарта. */
function assertScenarioExecution(report: ReadScenarioOutput): void {
  if (report.exitCode !== 0 || report.tests.some(test => test.status === "failed" || test.status === "error")) {
    throw storybookBuildError(storybookDiagnostic("validate", report.stderr || "Сценарий завершился с ошибкой", report.path))
  }
}

function validateModuleExports(
  descriptor: StorybookPackageBuildDescriptor,
  scenarios: readonly StorybookGeneratedScenario[],
): void {
  const modules = [
    ...scenarios.flatMap(scenario => scenario.kind === "component" ? [scenario.module] : []),
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
  scenarios: readonly StorybookGeneratedScenario[],
  outputs: Readonly<Record<string, unknown>>,
  projectRoot: string,
): void {
  const modules = [
    ...scenarios.flatMap(scenario => scenario.kind === "component" ? [scenario.module] : []),
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
