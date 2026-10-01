/**
Выбирает фактические входы подготовки одной ревизии пакета по её дескриптору.
Проверка байтов и сверка после сборки принадлежат техническому BuildInputs.

@packageDocumentation
*/
import Compiler, {type BuildCompiler} from "@build/compiler"
import Environment from "@build/environment"
import BuildInputs, {type BuildInputs as BuildInputsContract} from "@build/inputs"
import type {PackageBuildPlan} from "./contract"
import type {
  StorybookPackageBuildInputFingerprintPlan,
  StorybookPackageBuildInputFingerprintRequest,
} from "./contract/types"

export type {PackageBuildPlan} from "./contract"

type StorybookPackageCompilerInput = BuildCompiler.Input
type BuildInputFingerprint = BuildInputsContract.Output
type BuildInputAttestation = Awaited<ReturnType<typeof BuildInputs.attest>>
type BuildInputScope = StorybookPackageBuildInputFingerprintPlan["scope"]
type StorybookBuildInputFingerprintRequest = StorybookPackageBuildInputFingerprintRequest
type BuildInputPlan = StorybookPackageBuildInputFingerprintPlan
type StorybookBuildInputFingerprintComputer = ReturnType<PackageBuildPlan.Output["computer"]>
const {resolveStorybookPackageCompilerInputs} = Compiler

const BUILD_ABI = Object.freeze({
  browserTarget: "browser",
  browserFormat: "esm",
  browserSplitting: true,
  sourcemap: "external",
  minify: false,
  loader: {".wgsl": "text"},
})
/**
Определяет консервативную область исходников без запуска дочернего компилятора.

Корни берутся из того же контекста разрешения модулей, что и плагины компилятора.
Входной модуль браузера и файлы инструментов добавляются явно. Вложенный
`node_modules` не обходится целиком. Каталог кандидата исключается как результат.
*/
function resolveStorybookBuildInputScope(
  input: StorybookBuildInputFingerprintRequest,
): BuildInputScope {
  return resolveStorybookPackageBuildInputFingerprintPlan(input).scope
}

/** Задаёт план проверки пакета из дескриптора и выбранного контекста компилятора. */
function resolveStorybookPackageBuildInputFingerprintPlan(
  input: StorybookBuildInputFingerprintRequest,
): BuildInputPlan {
  const toolRoot = Environment.directory(input.toolRoot)
  const descriptor = input.descriptor
  const moduleSourcePaths = (descriptor.scenarioSpecs ?? []).flatMap(({sourcePaths}) => sourcePaths)
  const compilerInput: StorybookPackageCompilerInput = {
    toolRoot,
    packageRoot: descriptor.packageRoot,
    projectRoot: descriptor.projectRoot,
    moduleSourcePaths,
  }
  const compiler = resolveStorybookPackageCompilerInputs(compilerInput)
  const ownerRoots = [
    ...compiler.sourceRoots,
    descriptor.projectRoot,
    descriptor.packageRoot,
    toolRoot,
  ]
  return BuildInputs.plan({
    identity: descriptor,
    roots: ownerRoots,
    guardRoots: Environment.resolutionGuardRoots(ownerRoots),
    compilerRoots: [
      toolRoot,
      descriptor.packageRoot,
      Environment.compilerOwnerRoot(compiler.adapterPath),
      ...compiler.semanticSourceRoots,
    ],
    files: [
      descriptor.sourcePath,
      ...(descriptor.scenarioSpecs ?? []).flatMap(({sourcePaths}) => sourcePaths),
      ...(descriptor.resourceFiles ?? []).map(({sourcePath}) => sourcePath),
      input.browserEntryPath,
      ...compiler.configPaths,
      ...(input.additionalFilePaths ?? []),
    ],
    compilerAdapterPath: compiler.adapterPath,
    toolchainFiles: Environment.toolchainFiles(toolRoot),
    validationAbi: {
      graphProtocol: descriptor.graphSnapshot.protocol,
      build: BUILD_ABI,
      sharedBrowserIdentity: input.sharedBrowserIdentity ?? null,
    },
    ...(input.stagingDirectory === undefined ? {} : {excludedRoots: [input.stagingDirectory]}),
    ...(input.resolutionDirectories === undefined
      ? {}
      : {resolutionDirectories: input.resolutionDirectories}),
  })
}

/**
Вычисляет сравнимое после перезапуска свидетельство без процесса компилятора.

Идентичность inode/mtime сохраняется как build-time evidence, но итоговый digest
основан на канонических путях и байтах: безопасная замена файла теми же байтами
сохраняет возможность повторного использования результата после перезапуска.
*/
function computeStorybookBuildInputFingerprint(
  input: StorybookBuildInputFingerprintRequest,
): BuildInputFingerprint {
  return BuildInputs.read(resolveStorybookPackageBuildInputFingerprintPlan(input))
}

/**
Создаёт читатель для одного ограниченного прохода проверки сохранённых свидетельств.

Общие файлы разных пакетов повторно проверяются через файловые метки,
но их байты хешируются один раз. Сверка входов до и после сборки этот кэш не использует. Читатель повторно
читает файл при изменении dev/inode/size/mtime/ctime.
*/
function createStorybookBuildInputFingerprintComputer(): StorybookBuildInputFingerprintComputer {
  const reader = new BuildInputs()
  return (input): BuildInputFingerprint => reader.read(
    resolveStorybookPackageBuildInputFingerprintPlan(input),
  )
}

/** Фиксирует входы перед проверкой и сверяет их после сборки без наблюдателей файловой системы. */
async function beginStorybookBuildInputAttestation(
  input: StorybookBuildInputFingerprintRequest,
): Promise<BuildInputAttestation> {
  return BuildInputs.attest(resolveStorybookPackageBuildInputFingerprintPlan(input))
}


/** План, проверка и attestation одной пакетной ревизии используют тот же набор входов. */
const plan: PackageBuildPlan.Output = Object.freeze({
  scope: resolveStorybookBuildInputScope,
  resolve: resolveStorybookPackageBuildInputFingerprintPlan,
  compute: computeStorybookBuildInputFingerprint,
  computer: createStorybookBuildInputFingerprintComputer,
  attest: beginStorybookBuildInputAttestation,
})

export default plan
