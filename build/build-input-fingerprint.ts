/**
Выбирает входы пакетной сборки и общей оболочки по их фактическому compiler context.
Проверяемое содержимое, кэш чтения и сверка изменений принадлежат BuildInputs;
этот адаптер задаёт identity, исходники, конфигурацию, toolchain и ABI владельца.
Состав входов и формат сохранённых свидетельств при переносе сохранены.

@packageDocumentation
*/
import {lstatSync, readFileSync, realpathSync, statSync} from "node:fs"
import {basename, dirname, join, relative, resolve, sep} from "node:path"
import {fileURLToPath} from "node:url"
import BuildInputs, {type BuildInputFingerprint, type BuildInputPlan, type BuildInputAttestation, type BuildInputScope} from "@build/inputs"
import {resolveStorybookPackageCompilerInputs, type StorybookPackageCompilerInput} from "./compiler.ts"
import type {StorybookPackageBuildDescriptor} from "../sessions/package-session.ts"
import type {StorybookSharedBrowserIdentity} from "./types/shared-module-identity.ts"

const STORYBOOK_TOOL_ROOT = realpathSync(fileURLToPath(new URL("..", import.meta.url)))

const BUILD_ABI = Object.freeze({
  browserTarget: "browser",
  browserFormat: "esm",
  browserSplitting: true,
  sourcemap: "external",
  minify: false,
  loader: {".wgsl": "text"},
})
const SHARED_BUILD_ABI = Object.freeze({
  owner: "shared-browser",
  entryNaming: "[name]-[hash].[ext]",
  chunkNaming: "chunks/[name]-[hash].[ext]",
  publicPath: "/__storybook/shared/",
  target: "browser",
  format: "esm",
  splitting: true,
  sourcemap: "external",
  loader: {".wgsl": "text"},
})

/**
Вход пакетного адаптера связывает дескриптор с фактическими путями исполнения и компиляции.

@property descriptor - Граф, ресурсы, пути модулей и публичные имена конкретной ревизии пакета.

@property browserEntryPath - Входной модуль основного браузерного результата.

@property [stagingDirectory] - Каталог результата кандидата, исключённый из входов.

@property [additionalFilePaths] - Фактические зависимости, обнаруженные компилятором.

@property [resolutionDirectories] - Сохранённые внешние каталоги разрешения модулей для повторной проверки.
*/
export type StorybookBuildInputFingerprintRequest = Readonly<{
  descriptor: StorybookPackageBuildDescriptor
  browserEntryPath: string
  sharedBrowserIdentity?: StorybookSharedBrowserIdentity
  stagingDirectory?: string
  additionalFilePaths?: readonly string[]
  resolutionDirectories?: readonly string[]
}>

/** Проверка нескольких пакетов переиспользует байты общих исходников и инструментов. */
export type StorybookBuildInputFingerprintComputer = (
  input: StorybookBuildInputFingerprintRequest,
) => BuildInputFingerprint

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
  sharedKernel?: StorybookSharedBrowserIdentity
}>

/**
Определяет консервативную область исходников без запуска дочернего компилятора.

Корни берутся из того же контекста разрешения модулей, что и плагины компилятора.
Входной модуль браузера и файлы инструментов добавляются явно. Вложенный
`node_modules` не обходится целиком. Каталог кандидата исключается как результат.
*/
export function resolveStorybookBuildInputScope(
  input: StorybookBuildInputFingerprintRequest,
): BuildInputScope {
  return resolveStorybookPackageBuildInputFingerprintPlan(input).scope
}

/** Задаёт план проверки пакета из дескриптора и выбранного контекста компилятора. */
export function resolveStorybookPackageBuildInputFingerprintPlan(
  input: StorybookBuildInputFingerprintRequest,
): BuildInputPlan {
  const descriptor = input.descriptor
  const moduleSourcePaths = (descriptor.scenarioSpecs ?? []).flatMap(({sourcePaths}) => sourcePaths)
  const compilerInput: StorybookPackageCompilerInput = {
    packageRoot: descriptor.packageRoot,
    projectRoot: descriptor.projectRoot,
    moduleSourcePaths,
  }
  const compiler = resolveStorybookPackageCompilerInputs(compilerInput)
  const ownerRoots = [
    ...compiler.sourceRoots,
    descriptor.projectRoot,
    descriptor.packageRoot,
    STORYBOOK_TOOL_ROOT,
  ]
  return BuildInputs.plan({
    identity: descriptor,
    roots: ownerRoots,
    guardRoots: workspaceResolutionGuardRoots(ownerRoots),
    compilerRoots: [
      join(STORYBOOK_TOOL_ROOT, "build"),
      join(STORYBOOK_TOOL_ROOT, "archetypes"),
      join(STORYBOOK_TOOL_ROOT, "app"),
      descriptor.packageRoot,
      compilerOwnerRoot(compiler.adapterPath),
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
    toolchainFiles: toolchainFiles(),
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
Задаёт план общей оболочки по её входным модулям и контексту компилятора.

Идентичность не содержит каталога результата и пакетных полей исполнения.
Оболочка сохраняет собственное свидетельство без фиктивного дескриптора пакета.
*/
export function resolveStorybookSharedBuildInputFingerprintPlan(
  input: StorybookSharedBuildInputFingerprintRequest,
): BuildInputPlan {
  const toolRoot = canonicalDirectory(input.toolRoot)
  const entrypoints = [
    input.landingEntryPath,
    input.fallbackEntryPath,
    ...(input.packageEntryPath === undefined ? [] : [input.packageEntryPath]),
  ].map(canonicalExactFile)
  const compiler = resolveStorybookPackageCompilerInputs({
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
    guardRoots: workspaceResolutionGuardRoots(ownerRoots),
    compilerRoots: [
      join(STORYBOOK_TOOL_ROOT, "build"),
      compilerOwnerRoot(compiler.adapterPath),
      ...compiler.semanticSourceRoots,
    ],
    files: [
      ...entrypoints,
      ...compiler.configPaths,
      ...(input.additionalFilePaths ?? []),
    ],
    compilerAdapterPath: compiler.adapterPath,
    toolchainFiles: toolchainFiles(),
    validationAbi: SHARED_BUILD_ABI,
    excludedRoots: [input.stagingDirectory, input.outputDirectory].filter((path): path is string => path !== undefined),
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
export function computeStorybookBuildInputFingerprint(
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
export function createStorybookBuildInputFingerprintComputer(): StorybookBuildInputFingerprintComputer {
  const reader = new BuildInputs()
  return (input): BuildInputFingerprint => reader.read(
    resolveStorybookPackageBuildInputFingerprintPlan(input),
  )
}

/** Вычисляет свидетельство общей оболочки по её собственному плану. */
export function computeStorybookSharedBuildInputFingerprint(
  input: StorybookSharedBuildInputFingerprintRequest,
): BuildInputFingerprint {
  return BuildInputs.read(resolveStorybookSharedBuildInputFingerprintPlan(input))
}

/** Фиксирует входы перед проверкой и сверяет их после сборки без наблюдателей файловой системы. */
export async function beginStorybookBuildInputAttestation(
  input: StorybookBuildInputFingerprintRequest,
): Promise<BuildInputAttestation> {
  return BuildInputs.attest(resolveStorybookPackageBuildInputFingerprintPlan(input))
}

/** Сверяет входы общей оболочки тем же механизмом до и после её подготовки. */
export async function beginStorybookSharedBuildInputAttestation(
  input: StorybookSharedBuildInputFingerprintRequest,
): Promise<BuildInputAttestation> {
  return BuildInputs.attest(resolveStorybookSharedBuildInputFingerprintPlan(input))
}

let resolvedToolchainFiles: readonly string[] | null = null

/** Находит владельца адаптера компилятора, не включая соседний монорепозиторий целиком. */
function compilerOwnerRoot(adapterPath: string): string {
  let directory = dirname(adapterPath)
  while (true) {
    if (lstatFile(join(directory, "package.json"))) return canonicalDirectory(directory)
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`Cannot find Storybook compiler adapter owner: ${adapterPath}`)
}

/**
Находит существующие `node_modules` между owner roots и ближайшими Git roots.

Каталоги ограничивают допустимые зависимости: их полный inventory не читается и не
хешируется. Это покрывает обычный поиск Bun из вложенного workspace package к
hoisted dependency root до того, как metafile назовёт exact resolved file.
*/
function workspaceResolutionGuardRoots(ownerRoots: readonly string[]): readonly string[] {
  const guards = new Set<string>()
  for (const value of ownerRoots) {
    const root = canonicalDirectory(value)
    const boundary = nearestRepositoryRoot(root) ?? root
    let directory = root
    while (inside(boundary, directory)) {
      const modules = join(directory, "node_modules")
      if (directoryExists(modules)) guards.add(canonicalDirectory(modules))
      if (directory === boundary) break
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  return Object.freeze([...guards])
}

/** Возвращает ближайший checkout root, не переходя к соседним repositories. */
function nearestRepositoryRoot(path: string): string | null {
  let directory = path
  while (true) {
    if (pathExists(join(directory, ".git"))) return canonicalDirectory(directory)
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

/** Проверяет существующий каталог без создания resolver state. */
function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Проверяет filesystem entry любого допустимого вида. */
function pathExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/** Находит манифест и вход фактически установленного TypeScript. */
function toolchainFiles(): readonly string[] {
  if (resolvedToolchainFiles !== null) return resolvedToolchainFiles
  const entry = canonicalExactFile(Bun.resolveSync("typescript", STORYBOOK_TOOL_ROOT))
  let directory = dirname(entry)
  while (true) {
    const manifest = join(directory, "package.json")
    if (lstatFile(manifest)) {
      const value = JSON.parse(readFileSync(manifest, "utf8")) as unknown
      if (isObject(value) && value.name === "typescript") {
        resolvedToolchainFiles = Object.freeze([canonicalExactFile(manifest), entry])
        return resolvedToolchainFiles
      }
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error(`Cannot find TypeScript toolchain owner for ${entry}`)
}

/** Проверяет обычный файл без следования символьной ссылке в последнем сегменте. */
function canonicalExactFile(value: string): string {
  const parent = realpathSync.native(dirname(resolve(value)))
  const path = join(parent, basename(value))
  const stats = lstatSync(path)
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Storybook fingerprint input must be an exact non-symlink file: ${path}`)
  }
  return path
}

/** Разрешает существующий каталог в его канонический физический путь. */
function canonicalDirectory(value: string): string {
  const path = realpathSync.native(resolve(value))
  if (!statSync(path).isDirectory()) throw new Error(`Storybook fingerprint root must be a directory: ${path}`)
  return path
}

/** Проверяет возможный манифест без исключения при его отсутствии. */
function lstatFile(path: string): boolean {
  try {
    return lstatSync(path).isFile()
  } catch {
    return false
  }
}

/** Отличает JSON-объект от массива и примитива. */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** Проверяет вложенность пути с учётом регистра файловой системы хоста. */
function inside(root: string, path: string): boolean {
  const local = relative(comparablePath(root), comparablePath(path))
  return local === "" || (!local.startsWith(`..${sep}`) && local !== ".." && !local.startsWith(sep))
}

/** Нормализует сравнение путей, сохраняя фактическую идентичность возвращаемых данных. */
function comparablePath(value: string): string {
  const path = resolve(value)
  return process.platform === "darwin" || process.platform === "win32" ? path.toLowerCase() : path
}
