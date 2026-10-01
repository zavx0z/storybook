/**
Планирует проверку точных исходников статичной Web-оболочки и её host.
Результат и attestation передаются техническому BuildInputs.
*/
import Compiler from "@build/compiler"
import Environment, {type BuildEnvironment} from "@build/environment"
import BuildInputs, {type BuildInputs as BuildInputsContract} from "@build/inputs"
type BuildInputFingerprint = BuildInputsContract.Output
type BuildInputPlan = ReturnType<typeof BuildInputs.plan>
type BuildInputAttestation = Awaited<ReturnType<typeof BuildInputs.attest>>
const {resolveStorybookPackageCompilerInputs} = Compiler

const SHARED_BUILD_ABI = Object.freeze({
  owner: "shared-browser",
  artifactGraph: "relative-output-sha256/1",
  entryNaming: "[name]-[hash].[ext]",
  chunkNaming: "[name]-[hash].[ext]",
  publicPath: "",
  target: "browser",
  format: "esm",
  splitting: true,
  sourcemap: "external",
  loader: {".wgsl": "text"},
})

/**
Адаптер общей оболочки задаёт её собственные входы без фиктивного дескриптора пакета.

@property toolRoot - Корень владельца компилятора и входных модулей общей оболочки.

@property landingEntryPath - Вход главной страницы.

@property fallbackEntryPath - Вход страницы до применения пакетной ревизии.

@property [stagingDirectory] - Каталог кандидата текущей общей сборки.

@property [outputDirectory] - Каталог сохранённых ресурсов оболочки, исключённый из входов.

@property [additionalFilePaths] - Фактические зависимости общей оболочки из metafile.

@property [resolutionDirectories] - Сохранённые внешние каталоги разрешения модулей.
*/
export type StorybookSharedBuildInputFingerprintRequest = Readonly<{
  toolRoot: string
  landingEntryPath: string
  fallbackEntryPath: string
  packageEntryPath?: string
  stagingDirectory?: string
  outputDirectory?: string
  additionalFilePaths?: readonly string[]
  resolutionDirectories?: readonly string[]
  sharedKernel?: ReturnType<BuildEnvironment.Output["identity"]>
}>

/**
Задаёт план общей оболочки по её входным модулям и контексту компилятора.

Идентичность не содержит каталога результата и пакетных полей исполнения.
Оболочка сохраняет собственное свидетельство без фиктивного дескриптора пакета.
*/
export function resolveStorybookSharedBuildInputFingerprintPlan(
  input: StorybookSharedBuildInputFingerprintRequest,
): BuildInputPlan {
  const toolRoot = Environment.directory(input.toolRoot)
  const entrypoints = [
    input.landingEntryPath,
    input.fallbackEntryPath,
    ...(input.packageEntryPath === undefined ? [] : [input.packageEntryPath]),
  ].map(Environment.exactFile)
  const compiler = resolveStorybookPackageCompilerInputs({
    toolRoot,
    packageRoot: toolRoot,
    projectRoot: toolRoot,
    moduleSourcePaths: entrypoints,
  })
  const ownerRoots = [...compiler.sourceRoots, toolRoot]
  return BuildInputs.plan({
    identity: {
      owner: "shared-browser",
      ...(input.sharedKernel === undefined ? {} : {sharedKernel: input.sharedKernel.epoch}),
      toolRoot,
      landingEntryPath: entrypoints[0],
      fallbackEntryPath: entrypoints[1],
      ...(entrypoints[2] === undefined ? {} : {packageEntryPath: entrypoints[2]}),
    },
    roots: ownerRoots,
    guardRoots: Environment.resolutionGuardRoots(ownerRoots),
    compilerRoots: [
      toolRoot,
      Environment.compilerOwnerRoot(compiler.adapterPath),
      ...compiler.semanticSourceRoots,
    ],
    files: [
      ...entrypoints,
      ...compiler.configPaths,
      ...(input.additionalFilePaths ?? []),
    ],
    compilerAdapterPath: compiler.adapterPath,
    toolchainFiles: Environment.toolchainFiles(toolRoot),
    validationAbi: SHARED_BUILD_ABI,
    excludedRoots: [input.stagingDirectory, input.outputDirectory].filter((path): path is string => path !== undefined),
    ...(input.resolutionDirectories === undefined
      ? {}
      : {resolutionDirectories: input.resolutionDirectories}),
  })
}

/** Вычисляет свидетельство общей оболочки по её собственному плану. */
export function computeStorybookSharedBuildInputFingerprint(
  input: StorybookSharedBuildInputFingerprintRequest,
): BuildInputFingerprint {
  return BuildInputs.read(resolveStorybookSharedBuildInputFingerprintPlan(input))
}

/** Сверяет входы общей оболочки тем же механизмом до и после её подготовки. */
export async function beginStorybookSharedBuildInputAttestation(
  input: StorybookSharedBuildInputFingerprintRequest,
): Promise<BuildInputAttestation> {
  return BuildInputs.attest(resolveStorybookSharedBuildInputFingerprintPlan(input))
}
