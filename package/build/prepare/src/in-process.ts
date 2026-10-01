/** Исполняет одну package revision внутри точного compiler worker.

@packageDocumentation
*/
import PackageBuildPlanOwner from "@package-build/plan"
import BuildEnvironmentOwner from "@build/environment"
import PackageSessionOwner, {type PackageSession as PackageSessionContract} from "@package/session"
const beginStorybookBuildInputAttestation = PackageBuildPlanOwner.attest
const createStorybookSharedBrowserExternalPlugin = BuildEnvironmentOwner.externalPlugin
const validateStorybookSharedBrowserIdentity = BuildEnvironmentOwner.validate
const storybookBuildError = PackageSessionOwner.buildError
const storybookDiagnostic = PackageSessionOwner.diagnostic
type StorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
type StorybookPackageDiagnostic = ReturnType<PackageSessionContract.Output["snapshot"]>["diagnostics"][number]
type StorybookPackageRevisionResourceFile = NonNullable<PackageSessionContract.Input[0]["resourceFiles"]>[number]
import Compiler from "@build/compiler"
import {createHash} from "node:crypto"
import {closeSync, constants, fstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync} from "node:fs"
import {dirname, extname, isAbsolute, join, relative, resolve, sep} from "node:path"
import loader, {type PackageBuildLoader} from "@package-build/loader"
import conformance from "@package-build/conformance"
import prepareStorybookScenarios from "@package-build/scenarios"
import inputs from "@package-build/inputs"
import type {PackageBuildPrepare} from "../contract"
import type {BuilderInput, BuildResult, PhaseEvent, PhaseListener} from "../contract/build"

const {createStorybookPackageCompilerPlugins, ensureGeneratedJsxProtocol} = Compiler
const {check: checkStorybookPackageConformance, verify: scenarioVerification} = conformance
const {payloadFile: STORYBOOK_REVISION_PAYLOAD_FILE, generateLoaderSource: generateStorybookLoaderSource, generateJsxModules: generateStorybookJsxModules, generateAppliedRevisionLoaderSource: generateStorybookAppliedRevisionLoaderSource, generateRevisionPayloadSource: generateStorybookRevisionPayloadSource} = loader
const {canonicalBuildInputs, canonicalizeIdentities: canonicalizeStorybookPackageIdentities, stablePath: stableBuildInputPath, validateConsumerBoundary} = inputs
type StorybookGeneratedScenario = Parameters<PackageBuildLoader.Output["generateJsxModules"]>[0][number]

/** Выполняет сборку внутри isolated package worker либо focused test seam. */
export async function buildStorybookPackageRevisionInProcess(
  input: BuilderInput,
  options: PackageBuildPrepare.Input,
): Promise<BuildResult> {
  input.signal.throwIfAborted()
  const toolRoot = realpathSync(options.toolRoot)
  const browserEntryPath = realpathSync(options.browserEntryPath)
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

  return (async (): Promise<BuildResult> => {
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

/** Создаёт несовместимую между кандидатами эпоху для unshared transitional build. */
export function isolatedStorybookSharedModuleEpoch(packageId: string, candidateRevision: string): string {
  return createHash("sha256")
    .update(`isolated\0${packageId}\0${candidateRevision}`)
    .digest("hex")
}

/** Создаёт timestamped phase boundary и изолирует build от observer exception. */
function emitPhase(
  listener: PhaseListener | undefined,
  phase: PhaseEvent["phase"],
  state: PhaseEvent["state"],
): void {
  notifyPhase(listener, Object.freeze({phase, state, at: new Date().toISOString()}))
}

/** Observer не получает права ломать либо менять результат compiler operation. */
function notifyPhase(
  listener: PhaseListener | undefined,
  event: PhaseEvent,
): void {
  try {
    listener?.(event)
  } catch {
    // Scheduler observability не влияет на корректность compiler.
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
