import {createHash} from "node:crypto"
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  watch,
  type FSWatcher,
} from "node:fs"
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from "node:path"
import {fileURLToPath} from "node:url"
import {
  resolveStorybookPackageCompilerInputs,
  type StorybookPackageCompilerInput,
} from "./compiler.ts"
import type {StorybookPackageBuildDescriptor} from "../sessions/package-session.ts"
import type {StorybookSharedBrowserIdentity} from "./types/shared-module-identity.ts"

/** Версия persisted evidence, несовместимая с прежним списком browser metafile inputs. */
export const STORYBOOK_BUILD_INPUT_FINGERPRINT_PROTOCOL = "storybook-build-input/1" as const

const STORYBOOK_TOOL_ROOT = realpathSync(fileURLToPath(new URL("..", import.meta.url)))
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  ".cache",
  ".turbo",
  "coverage",
  "artifacts",
  ".artifacts",
])
const BUILD_ABI = Object.freeze({
  browserTarget: "browser",
  browserFormat: "esm",
  browserSplitting: true,
  sourcemap: "external",
  minify: false,
  runtimeProtocol: "storybook-runtime/4",
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
@property path - Канонический lexical path, входящий в owner/resolver boundary.

@property contentDigest - SHA-256 байтов, используемый для restart comparison.

@property size - Число прочитанных байтов.

@property device - Устройство открытого exact non-symlink файла во время attestation.

@property inode - Inode открытого файла во время attestation.

@property modifiedNs - Время изменения из того же `fstat`, что и прочитанные байты.
*/
export type StorybookBuildInputFile = Readonly<{
  path: string
  contentDigest: string
  size: number
  device: string
  inode: string
  modifiedNs: string
}>

/**
@property protocol - Версия состава и canonical serialization fingerprint.

@property digest - Итоговый cache key всех категорий; неизвестная версия всегда miss.

@property descriptorDigest - Exact descriptor, graph, resources, routes и export names.

@property sourceDigest - Canonical owner roots, inventory и байты source/config/resource files.

@property toolchainDigest - Bun executable/version и точные TypeScript/compiler owner inputs.

@property validationDigest - Build options и ABI validation/runtime protocol.

@property roots - Корни owner graph; служат доказательством консервативного inventory scope.

@property resolutionDirectories - Каталоги external closure, где новый соседний файл меняет resolution.

@property watchDirectories - Уже посещённые каталоги source inventory и resolution closure.

@property files - Exact closure и control files с полным byte evidence.
*/
export type StorybookBuildInputFingerprint = Readonly<{
  protocol: typeof STORYBOOK_BUILD_INPUT_FINGERPRINT_PROTOCOL
  digest: string
  descriptorDigest: string
  sourceDigest: string
  toolchainDigest: string
  validationDigest: string
  roots: readonly string[]
  resolutionDirectories: readonly string[]
  watchDirectories: readonly string[]
  files: readonly StorybookBuildInputFile[]
}>

/**
Package adapter input совпадает с фактическими entry/protocol/compiler путями.

@property descriptor - Exact graph, resources, module paths и export names package revision.

@property browserEntryPath - Host entry основного browser bundle.

@property runtimeProtocolPath - Валидатор `storybook-runtime/4` отдельного protocol bundle.

@property [stagingDirectory] - Candidate output, исключённый из source inventory.

@property [additionalFilePaths] - Фактическая main/protocol metafile closure.

@property [resolutionDirectories] - Persisted external directories при повторной проверке receipt.
*/
export type StorybookBuildInputFingerprintRequest = Readonly<{
  descriptor: StorybookPackageBuildDescriptor
  browserEntryPath: string
  runtimeProtocolPath: string
  sharedBrowserIdentity?: StorybookSharedBrowserIdentity
  stagingDirectory?: string
  additionalFilePaths?: readonly string[]
  resolutionDirectories?: readonly string[]
}>

/** Reusable resident computer дедуплицирует чтение общих owner/toolchain bytes при restore. */
export type StorybookBuildInputFingerprintComputer = (
  input: StorybookBuildInputFingerprintRequest,
) => StorybookBuildInputFingerprint

/**
@property identity - JSON-like owner contract, хешируемый как прежний `descriptorDigest`.

@property scope - Канонические owner roots, exact files и output exclusions.

@property compilerAdapterPath - Exact compiler plugin entry, входящий в toolchain digest.

@property toolchainFiles - Exact runtime/compiler files установленного toolchain.

@property validationAbi - Build options и protocol constants конкретного владельца.
*/
export type StorybookBuildInputFingerprintPlan = Readonly<{
  identity: unknown
  scope: StorybookBuildInputScope
  compilerAdapterPath: string
  toolchainFiles: readonly string[]
  validationAbi: Readonly<Record<string, unknown>>
}>

/**
Raw plan input позволяет package и shared adapters использовать один fingerprint core.

@property identity - Декларативные входы владельца без output state.

@property roots - Owner roots полного path inventory и event guard.

@property compilerRoots - TypeScript semantic roots, чьи source bytes влияют на compiler.

@property [guardRoots] - Предварительные roots legitimate resolver output без inventory crawl.

@property files - Exact entry/config/resource/closure files.

@property compilerAdapterPath - Публичный adapter фактически выбранного compiler plugin.

@property toolchainFiles - Exact installed toolchain entries вне owner inventory.

@property validationAbi - Build/protocol options, которые меняют смысл успешной проверки.

@property [excludedRoots] - Output/candidate roots текущей операции.

@property [resolutionDirectories] - Persisted external resolution directories.
*/
export type StorybookBuildInputFingerprintPlanInput = Readonly<{
  identity: unknown
  roots: readonly string[]
  guardRoots?: readonly string[]
  compilerRoots: readonly string[]
  files: readonly string[]
  compilerAdapterPath: string
  toolchainFiles: readonly string[]
  validationAbi: Readonly<Record<string, unknown>>
  excludedRoots?: readonly string[]
  resolutionDirectories?: readonly string[]
}>

/** Reusable computer одного bounded pass принимает уже owner-specific plan. */
export type StorybookBuildInputFingerprintPlanComputer = (
  plan: StorybookBuildInputFingerprintPlan,
) => StorybookBuildInputFingerprint

/**
Shared adapter не подменяет package descriptor или runtime protocol.

@property toolRoot - Exact owner compiler и обоих browser entrypoints.

@property landingEntryPath - Entry общей landing page.

@property fallbackEntryPath - Entry fallback page до package activation.

@property [stagingDirectory] - Candidate output текущей shared operation.

@property [outputDirectory] - Persisted shared assets/receipt root, исключённый из inputs.

@property [additionalFilePaths] - Фактическая shared metafile closure.

@property [resolutionDirectories] - Persisted external resolution directories.
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
}>

/**
@property roots - Минимизированные canonical owner roots для inventory и event guard.

@property guardRoots - Inventory roots плюс известные npm resolution roots только для watcher/assertion.

@property files - Exact inputs вне либо внутри roots, которые нельзя потерять из fingerprint.

@property compilerRoots - Узкие implementation roots compiler plugins, хешируемые целиком.

@property resolutionDirectories - External каталоги, исключённые из полного owner inventory.

@property excludedRoots - Candidate artifacts текущей операции, создаваемые самой сборкой.
*/
export type StorybookBuildInputScope = Readonly<{
  roots: readonly string[]
  guardRoots: readonly string[]
  files: readonly string[]
  compilerRoots: readonly string[]
  resolutionDirectories: readonly string[]
  excludedRoots: readonly string[]
}>

/**
Сессия attestation окружает все compiler/protocol phases одним event-driven guard.

`complete` возвращает evidence только если pre/post bytes и inventory совпали и
watcher не наблюдал transient изменения между чтениями. Любая неопределённость
завершает cold build ошибкой вместо публикации ложного cache key.
*/
export type StorybookBuildInputAttestation = Readonly<{
  before: StorybookBuildInputFingerprint
  complete(additionalFilePaths?: readonly string[]): Promise<StorybookBuildInputFingerprint>
  dispose(): void
}>

/**
Определяет консервативный owner/source scope без запуска compiler child.

Корни берутся из того же resolver/compiler context, что plugin setup. Отдельно
добавляются browser host, runtime protocol, Bun executable и TypeScript entry.
`node_modules` внутри owner roots не обходится; exact toolchain files добавляются
явно. Текущий staging всегда исключён как output, а не build input.
*/
export function resolveStorybookBuildInputScope(
  input: StorybookBuildInputFingerprintRequest,
): StorybookBuildInputScope {
  return resolveStorybookPackageBuildInputFingerprintPlan(input).scope
}

/** Канонизирует generic plan до вычисления digest или установки watcher. */
export function createStorybookBuildInputFingerprintPlan(
  input: StorybookBuildInputFingerprintPlanInput,
): StorybookBuildInputFingerprintPlan {
  if (!isObject(input.validationAbi)) {
    throw new TypeError("Storybook build input validationAbi must be an object")
  }
  const roots = minimalRoots(input.roots.map(canonicalDirectory))
  const guardRoots = minimalGuardRoots([
    ...roots,
    ...(input.guardRoots ?? []).map(canonicalDirectory),
  ])
  const compilerAdapterPath = canonicalExactFile(input.compilerAdapterPath)
  const toolchain = input.toolchainFiles.map(canonicalExactFile)
  const files = [
    ...input.files,
    compilerAdapterPath,
    ...toolchain,
  ].map(canonicalExactFile)
  const compilerRoots = minimalRoots(input.compilerRoots.map(canonicalDirectory))
  const excludedRoots = Object.freeze((input.excludedRoots ?? []).map(canonicalFuturePath).sort(comparePaths))
  const resolutionDirectories = Object.freeze([...new Set([
    ...(input.resolutionDirectories ?? []).map(canonicalDirectory),
    ...files.flatMap((path) => coveredByInventory(roots, path) ? [] : resolutionAncestors(path)),
  ])].sort(comparePaths))
  return Object.freeze({
    identity: input.identity,
    scope: Object.freeze({
      roots,
      guardRoots,
      files: Object.freeze([...new Set(files)].sort(comparePaths)),
      compilerRoots,
      resolutionDirectories,
      excludedRoots,
    }),
    compilerAdapterPath,
    toolchainFiles: Object.freeze([...new Set(toolchain)].sort(comparePaths)),
    validationAbi: Object.freeze({...input.validationAbi}),
  })
}

/** Создаёт package-specific plan, сохраняя существующую fingerprint semantics. */
export function resolveStorybookPackageBuildInputFingerprintPlan(
  input: StorybookBuildInputFingerprintRequest,
): StorybookBuildInputFingerprintPlan {
  const descriptor = input.descriptor
  const moduleSourcePaths = descriptorModules(descriptor).map(({path}) => path)
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
  return createStorybookBuildInputFingerprintPlan({
    identity: descriptor,
    roots: ownerRoots,
    guardRoots: workspaceResolutionGuardRoots(ownerRoots),
    compilerRoots: [
      join(STORYBOOK_TOOL_ROOT, "build"),
      compilerOwnerRoot(compiler.adapterPath),
      ...compiler.semanticSourceRoots,
    ],
    files: [
      descriptor.sourcePath,
      ...descriptorModules(descriptor).map(({path}) => path),
      ...(descriptor.resourceFiles ?? []).map(({sourcePath}) => sourcePath),
      input.browserEntryPath,
      input.runtimeProtocolPath,
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
Создаёт shared plan по двум реальным entrypoints и тому же compiler context.

Identity не содержит output root и package runtime fields: shared wrapper может
сохранить fingerprint рядом со своими assets без фиктивного package descriptor.
*/
export function resolveStorybookSharedBuildInputFingerprintPlan(
  input: StorybookSharedBuildInputFingerprintRequest,
): StorybookBuildInputFingerprintPlan {
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
  return createStorybookBuildInputFingerprintPlan({
    identity: {
      owner: "shared-browser",
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
Вычисляет restart-comparable fingerprint в resident процессе без compiler worker.

Идентичность inode/mtime сохраняется как build-time evidence, но итоговый digest
основан на canonical path и байтах: безопасная замена exact файла теми же байтами
не создаёт ложный miss после restart.
*/
export function computeStorybookBuildInputFingerprint(
  input: StorybookBuildInputFingerprintRequest,
): StorybookBuildInputFingerprint {
  return computeStorybookBuildInputFingerprintPlan(resolveStorybookPackageBuildInputFingerprintPlan(input))
}

/** Вычисляет fingerprint уже канонизированного owner-specific plan. */
export function computeStorybookBuildInputFingerprintPlan(
  plan: StorybookBuildInputFingerprintPlan,
): StorybookBuildInputFingerprint {
  return computeFingerprint(plan)
}

/**
Создаёт computer для одного bounded receipt-verification pass.

Общие файлы десятков package descriptors повторно проверяются через stat identity,
но их байты хешируются один раз. Кэш не используется build attestation и повторно
читает файл при изменении dev/inode/size/mtime/ctime.
*/
export function createStorybookBuildInputFingerprintComputer(): StorybookBuildInputFingerprintComputer {
  const compute = createStorybookBuildInputFingerprintPlanComputer()
  return (input): StorybookBuildInputFingerprint => compute(
    resolveStorybookPackageBuildInputFingerprintPlan(input),
  )
}

/** Создаёт reusable computer для package или shared plans одного verification pass. */
export function createStorybookBuildInputFingerprintPlanComputer(): StorybookBuildInputFingerprintPlanComputer {
  const cache: FingerprintComputationCache = {
    files: new Map(),
    inventories: new Map(),
  }
  return (plan): StorybookBuildInputFingerprint => computeFingerprint(plan, cache)
}

/** Вычисляет shared fingerprint без package descriptor. */
export function computeStorybookSharedBuildInputFingerprint(
  input: StorybookSharedBuildInputFingerprintRequest,
): StorybookBuildInputFingerprint {
  return computeStorybookBuildInputFingerprintPlan(resolveStorybookSharedBuildInputFingerprintPlan(input))
}

/**
Начинает event-driven защиту source roots до первого чтения fingerprint.

На macOS и Windows используется один recursive watcher на корень; в остальных
средах watchers создаются для уже аттестованных каталогов. Невозможность
установить guard — fail closed, потому что concurrent-change evidence неизвестно.
*/
export async function beginStorybookBuildInputAttestation(
  input: StorybookBuildInputFingerprintRequest,
): Promise<StorybookBuildInputAttestation> {
  return beginStorybookBuildInputPlanAttestation(resolveStorybookPackageBuildInputFingerprintPlan(input))
}

/** Shared wrapper использует ту же concurrent-change attestation по своему plan. */
export async function beginStorybookSharedBuildInputAttestation(
  input: StorybookSharedBuildInputFingerprintRequest,
): Promise<StorybookBuildInputAttestation> {
  return beginStorybookBuildInputPlanAttestation(resolveStorybookSharedBuildInputFingerprintPlan(input))
}

/** Начинает generic event-driven attestation для уже выбранного owner plan. */
export async function beginStorybookBuildInputPlanAttestation(
  plan: StorybookBuildInputFingerprintPlan,
): Promise<StorybookBuildInputAttestation> {
  const scope = plan.scope
  const guard = createChangeGuard(scope)
  const cache: FingerprintComputationCache = {
    files: new Map(),
    inventories: new Map(),
  }
  try {
    const before = computeFingerprint(plan, cache)
    await yieldToWatchers()
    if (guard.changed() !== null) throw concurrentChangeError(guard.changed() ?? undefined)
    let finished = false
    return Object.freeze({
      before,
      async complete(additionalFilePaths: readonly string[] = []): Promise<StorybookBuildInputFingerprint> {
        if (finished) throw new Error("Storybook build input attestation is already complete")
        finished = true
        const unwatched = additionalFilePaths.map(canonicalExactFile)
          .filter((path) => !scope.guardRoots.some((root) => inside(root, path)))
        if (unwatched.length > 0) {
          throw new Error(`Storybook compiled input escaped attested owner roots: ${unwatched[0]}`)
        }
        await yieldToWatchers()
        const changedAfterBuild = guard.changed()
        if (changedAfterBuild !== null) {
          throw concurrentChangeError(changedAfterBuild ?? undefined)
        }
        const final = additionalFilePaths.length === 0
          ? before
          : computeFingerprint(
            extendStorybookBuildInputFingerprintPlan(plan, additionalFilePaths),
            cache,
            true,
          )
        await yieldToWatchers()
        const changedAfterClosure = guard.changed()
        if (changedAfterClosure !== null) throw concurrentChangeError(changedAfterClosure)
        return final
      },
      dispose(): void {
        guard.close()
      },
    })
  } catch (error) {
    guard.close()
    throw error
  }
}

/** Добавляет attested metafile closure, не меняя identity/toolchain/ABI владельца. */
function extendStorybookBuildInputFingerprintPlan(
  plan: StorybookBuildInputFingerprintPlan,
  additionalFilePaths: readonly string[],
): StorybookBuildInputFingerprintPlan {
  return createStorybookBuildInputFingerprintPlan({
    identity: plan.identity,
    roots: plan.scope.roots,
    guardRoots: plan.scope.guardRoots,
    compilerRoots: plan.scope.compilerRoots,
    files: [...plan.scope.files, ...additionalFilePaths],
    compilerAdapterPath: plan.compilerAdapterPath,
    toolchainFiles: plan.toolchainFiles,
    validationAbi: plan.validationAbi,
    excludedRoots: plan.scope.excludedRoots,
    resolutionDirectories: plan.scope.resolutionDirectories,
  })
}

/** Даёт event loop доставить уже поставленные fs.watch callbacks перед решением. */
async function yieldToWatchers(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/** Unknown, missing или old evidence никогда не считается cache hit. */
export function parseStorybookBuildInputFingerprint(
  value: unknown,
): StorybookBuildInputFingerprint | null {
  if (!isObject(value) || value.protocol !== STORYBOOK_BUILD_INPUT_FINGERPRINT_PROTOCOL ||
    !digest(value.digest) || !digest(value.descriptorDigest) || !digest(value.sourceDigest) ||
    !digest(value.toolchainDigest) || !digest(value.validationDigest) ||
    !canonicalPathList(value.roots) ||
    !canonicalPathList(value.resolutionDirectories) ||
    !canonicalPathList(value.watchDirectories) ||
    !Array.isArray(value.files)) return null
  const files = value.files.flatMap((candidate) => {
    if (!isObject(candidate) || !isAbsoluteString(candidate.path) || !digest(candidate.contentDigest) ||
      !Number.isSafeInteger(candidate.size) || Number(candidate.size) < 0 ||
      !decimal(candidate.device) || !decimal(candidate.inode) || !decimal(candidate.modifiedNs)) return []
    return [Object.freeze({
      path: candidate.path,
      contentDigest: candidate.contentDigest,
      size: Number(candidate.size),
      device: candidate.device,
      inode: candidate.inode,
      modifiedNs: candidate.modifiedNs,
    })]
  })
  if (files.length !== value.files.length) return null
  const expectedDigest = hash(stableStringify({
    protocol: STORYBOOK_BUILD_INPUT_FINGERPRINT_PROTOCOL,
    descriptorDigest: value.descriptorDigest,
    sourceDigest: value.sourceDigest,
    toolchainDigest: value.toolchainDigest,
    validationDigest: value.validationDigest,
  }))
  if (value.digest !== expectedDigest) return null
  return Object.freeze({
    protocol: STORYBOOK_BUILD_INPUT_FINGERPRINT_PROTOCOL,
    digest: value.digest,
    descriptorDigest: value.descriptorDigest,
    sourceDigest: value.sourceDigest,
    toolchainDigest: value.toolchainDigest,
    validationDigest: value.validationDigest,
    roots: Object.freeze([...value.roots]),
    resolutionDirectories: Object.freeze([...value.resolutionDirectories]),
    watchDirectories: Object.freeze([...value.watchDirectories]),
    files: Object.freeze(files),
  })
}

/**
Проецирует verified evidence в единый bounded набор existing watch targets.

Exact files ловят изменение bytes, а directories — создание, удаление и смену
resolution candidates. Helper не открывает compiler context и не повторяет
inventory policy; invalid/old evidence возвращает `null`.
*/
export function storybookBuildInputFingerprintWatchPaths(
  value: unknown,
): readonly string[] | null {
  const fingerprint = parseStorybookBuildInputFingerprint(value)
  if (fingerprint === null) return null
  return Object.freeze([...new Set([
    ...fingerprint.files.map(({path}) => path),
    ...fingerprint.watchDirectories,
  ])].sort(comparePaths))
}

/** Сравнивает только валидное versioned evidence; inode/mtime не являются restart key. */
export function sameStorybookBuildInputFingerprint(left: unknown, right: unknown): boolean {
  const first = parseStorybookBuildInputFingerprint(left)
  const second = parseStorybookBuildInputFingerprint(right)
  return first !== null && second !== null &&
    first.digest === second.digest &&
    first.descriptorDigest === second.descriptorDigest &&
    first.sourceDigest === second.sourceDigest &&
    first.toolchainDigest === second.toolchainDigest &&
    first.validationDigest === second.validationDigest
}

/** Строит category digests из одного отсортированного snapshot файлов. */
function computeFingerprint(
  plan: StorybookBuildInputFingerprintPlan,
  cache?: FingerprintComputationCache,
  trustCache = false,
): StorybookBuildInputFingerprint {
  const scope = plan.scope
  const filePaths = new Set(scope.files)
  const inventory = scopeInventory(scope, cache, trustCache)
  for (const path of inventory.evidencePaths) filePaths.add(path)
  const files = Object.freeze([...filePaths]
    .filter((path) => !excluded(path, scope.excludedRoots))
    .sort(comparePaths)
    .map((path) => cache === undefined ? readExactFile(path) : readCachedFile(path, cache.files, trustCache)))
  const descriptorDigest = hash(stableStringify(plan.identity))
  const resolutionInventory = scope.resolutionDirectories.map(readDirectoryInventory)
  const watchDirectories = Object.freeze([...new Set([
    ...inventory.directories.map(({path}) => path),
    ...scope.resolutionDirectories,
  ])].sort(comparePaths))
  const sourceDigest = hash(stableStringify({
    roots: scope.roots,
    inventory: inventory.paths,
    resolutionDirectories: resolutionInventory,
    watchDirectories,
    files: files.map(({path, contentDigest, size}) => ({path, contentDigest, size})),
  }))
  const toolchainDigest = hash(stableStringify({
    bun: Bun.version,
    executable: readCachedToolchainFile(process.execPath),
    typescript: plan.toolchainFiles.map(readCachedToolchainFile),
    adapter: files.find(({path}) => path === plan.compilerAdapterPath)?.contentDigest ?? null,
  }))
  const validationDigest = hash(stableStringify({
    fingerprint: STORYBOOK_BUILD_INPUT_FINGERPRINT_PROTOCOL,
    ...plan.validationAbi,
  }))
  const result = {
    protocol: STORYBOOK_BUILD_INPUT_FINGERPRINT_PROTOCOL,
    descriptorDigest,
    sourceDigest,
    toolchainDigest,
    validationDigest,
    roots: scope.roots,
    resolutionDirectories: scope.resolutionDirectories,
    watchDirectories,
    files,
  } as const
  const digestValue = hash(stableStringify({
    protocol: STORYBOOK_BUILD_INPUT_FINGERPRINT_PROTOCOL,
    descriptorDigest,
    sourceDigest,
    toolchainDigest,
    validationDigest,
  }))
  return Object.freeze({
    ...result,
    digest: digestValue,
  })
}

/** Kernel identity cache дополнительно хранит ctime, не входящий в restart digest. */
type CachedFileEvidence = Readonly<{
  evidence: StorybookBuildInputFile
  changedNs: string
}>

/** Directory marker доказывает, что cached path inventory не изменился. */
type CachedDirectoryEvidence = Readonly<{
  path: string
  device: string
  inode: string
  modifiedNs: string
  changedNs: string
}>

/** Один cached inventory остаётся валиден только при совпадении всех directory markers. */
type CachedInventory = Readonly<{
  paths: readonly string[]
  evidencePaths: readonly string[]
  directories: readonly CachedDirectoryEvidence[]
}>

/** Reusable verifier cache отделяет file bytes от directory inventory. */
type FingerprintComputationCache = {
  files: Map<string, CachedFileEvidence>
  inventories: Map<string, CachedInventory>
}

/** Повторно использует inventory одинакового owner scope после дешёвой проверки каталогов. */
function scopeInventory(
  scope: StorybookBuildInputScope,
  cache?: FingerprintComputationCache,
  trustCache = false,
): CachedInventory {
  const key = stableStringify({
    roots: scope.roots,
    compilerRoots: scope.compilerRoots,
    excludedRoots: scope.excludedRoots,
  })
  const cached = cache?.inventories.get(key)
  if (cached !== undefined && (trustCache || cached.directories.every(sameDirectoryEvidence))) return cached
  const paths = new Set<string>()
  const evidencePaths = new Set<string>()
  const directories: CachedDirectoryEvidence[] = []
  for (const root of scope.roots) {
    collectInventory(root, scope.compilerRoots, scope.excludedRoots, paths, evidencePaths, directories)
  }
  const inventory = Object.freeze({
    paths: Object.freeze([...paths].sort(comparePaths)),
    evidencePaths: Object.freeze([...evidencePaths].sort(comparePaths)),
    directories: Object.freeze(directories.sort((left, right) => comparePaths(left.path, right.path))),
  })
  cache?.inventories.set(key, inventory)
  return inventory
}

/** Сверяет cached directory без чтения всех дочерних entries. */
function sameDirectoryEvidence(evidence: CachedDirectoryEvidence): boolean {
  try {
    const current = statSync(evidence.path, {bigint: true})
    return current.isDirectory() && evidence.device === current.dev.toString() &&
      evidence.inode === current.ino.toString() && evidence.modifiedNs === current.mtimeNs.toString() &&
      evidence.changedNs === current.ctimeNs.toString()
  } catch {
    return false
  }
}

/** Сравнивает два kernel snapshot одного каталога внутри одного inventory pass. */
function sameDirectoryMarkers(
  left: CachedDirectoryEvidence,
  right: CachedDirectoryEvidence,
): boolean {
  return left.path === right.path && left.device === right.device && left.inode === right.inode &&
    left.modifiedNs === right.modifiedNs && left.changedNs === right.changedNs
}

/** Снимает kernel markers каталога после чтения его entries. */
function directoryEvidence(path: string): CachedDirectoryEvidence {
  const value = statSync(path, {bigint: true})
  if (!value.isDirectory()) throw new Error(`Storybook fingerprint inventory root is not a directory: ${path}`)
  return Object.freeze({
    path,
    device: value.dev.toString(),
    inode: value.ino.toString(),
    modifiedNs: value.mtimeNs.toString(),
    changedNs: value.ctimeNs.toString(),
  })
}

/** Повторно использует bytes только пока все kernel change markers совпадают. */
function readCachedFile(
  path: string,
  cache: Map<string, CachedFileEvidence>,
  trustCache = false,
): StorybookBuildInputFile {
  const canonical = canonicalExactFile(path)
  const cached = cache.get(canonical)
  if (trustCache && cached !== undefined) return cached.evidence
  const current = statSync(canonical, {bigint: true})
  if (cached !== undefined && cached.evidence.device === current.dev.toString() &&
    cached.evidence.inode === current.ino.toString() && cached.evidence.size === Number(current.size) &&
    cached.evidence.modifiedNs === current.mtimeNs.toString() && cached.changedNs === current.ctimeNs.toString()) {
    return cached.evidence
  }
  const evidence = readExactFile(canonical)
  const verified = statSync(canonical, {bigint: true})
  cache.set(canonical, Object.freeze({evidence, changedNs: verified.ctimeNs.toString()}))
  return evidence
}

/** Возвращает executable modules, влияющие на loader, exports и protocol validation. */
function descriptorModules(
  descriptor: StorybookPackageBuildDescriptor,
): readonly Readonly<{path: string; export: string}>[] {
  return Object.freeze([
    ...(descriptor.runtime === null ? [] : [descriptor.runtime]),
    ...descriptor.variants.map(({module}) => module),
    ...descriptor.widgetModules.map(({module}) => module),
  ])
}

/** Рекурсивно собирает bounded owner inventory, не заходя в ambient install/cache roots. */
function collectInventory(
  root: string,
  compilerRoots: readonly string[],
  excludedRoots: readonly string[],
  inventory: Set<string>,
  evidence: Set<string>,
  directories: CachedDirectoryEvidence[],
): void {
  const visit = (directory: string): void => {
    if (excluded(directory, excludedRoots)) return
    const before = directoryEvidence(directory)
    for (const entry of readdirSync(directory, {withFileTypes: true}).sort((left, right) =>
      comparePaths(left.name, right.name))) {
      if (entry.isSymbolicLink()) {
        inventory.add(join(directory, entry.name))
        continue
      }
      if (entry.isDirectory() && ignoredDirectoryName(entry.name)) continue
      const path = join(directory, entry.name)
      if (excluded(path, excludedRoots)) continue
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) {
        inventory.add(path)
        if ((compilerRoots.some((compilerRoot) => inside(compilerRoot, path)) && compilerSemanticFile(entry.name)) ||
          controlFile(entry.name)) {
          evidence.add(path)
        }
      }
    }
    const after = directoryEvidence(directory)
    if (!sameDirectoryMarkers(before, after)) throw concurrentChangeError(directory)
    directories.push(after)
  }
  visit(root)
}

/** Хеширует содержимое resolver/config/lock inputs независимо от main metafile. */
function controlFile(name: string): boolean {
  return name === "package.json" || name === "bun.lock" || name === "bun.lockb" ||
    name === "bunfig.toml" || name === "package-lock.json" || name === "pnpm-lock.yaml" ||
    name === "yarn.lock" || name === ".npmrc" || /^(?:ts|js)config(?:\.[^.]+)?\.json$/u.test(name)
}

/** Совпадает с source inventory, который Template plugin передаёт TypeScript session. */
function compilerSemanticFile(name: string): boolean {
  return /\.(?:[cm]?[jt]sx?|[cm][jt]sx?)$/u.test(name)
}

/** Проверяет, входит ли exact file в полный inventory без ambient exclusions. */
function coveredByInventory(roots: readonly string[], path: string): boolean {
  return roots.some((root) => inside(root, path) && !ignoredRelativePath(root, path))
}

/**
Возвращает resolution directories external файла до ближайшего package owner.

Для файла вне package достаточно его непосредственного каталога. Для ambient
`node_modules` добавляется цепочка до каталога с `package.json`, чтобы появление
соседнего extension/index/export candidate инвалидировало persisted evidence.
*/
function resolutionAncestors(path: string): readonly string[] {
  const first = canonicalDirectory(dirname(path))
  const output = [first]
  if (!first.split(sep).includes("node_modules")) return Object.freeze(output)
  let directory = first
  for (let depth = 0; depth < 16; depth += 1) {
    if (lstatFile(join(directory, "package.json"))) break
    const parent = dirname(directory)
    if (parent === directory) break
    directory = canonicalDirectory(parent)
    output.push(directory)
  }
  return Object.freeze(output)
}

/** Читает имена и виды direct entries между двумя одинаковыми directory snapshots. */
function readDirectoryInventory(path: string): Readonly<{path: string; entries: readonly string[]}> {
  const before = directoryEvidence(path)
  const entries = readdirSync(path, {withFileTypes: true})
    .map((entry) => `${entry.isDirectory() ? "d" : entry.isFile() ? "f" : entry.isSymbolicLink() ? "l" : "o"}:${entry.name}`)
    .sort(comparePaths)
  const after = directoryEvidence(path)
  if (!sameDirectoryMarkers(before, after)) throw concurrentChangeError(path)
  return Object.freeze({path, entries: Object.freeze(entries)})
}

/** Находит package owner compiler adapter, не включая весь соседний monorepo. */
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

Каталоги добавляются только в event guard: их полный inventory не читается и не
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
  return minimalGuardRoots([...guards])
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

/** Читает bytes через O_NOFOLLOW и сверяет identity до/после чтения. */
function readExactFile(path: string): StorybookBuildInputFile {
  const canonical = canonicalExactFile(path)
  const descriptor = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = fstatSync(descriptor, {bigint: true})
    const bytes = readFileSync(descriptor)
    const after = fstatSync(descriptor, {bigint: true})
    const current = statSync(canonical, {bigint: true})
    if (!before.isFile() || before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
      after.dev !== current.dev || after.ino !== current.ino) {
      throw concurrentChangeError(canonical)
    }
    return Object.freeze({
      path: canonical,
      contentDigest: createHash("sha256").update(bytes).digest("hex"),
      size: Number(after.size),
      device: after.dev.toString(),
      inode: after.ino.toString(),
      modifiedNs: after.mtimeNs.toString(),
    })
  } finally {
    closeSync(descriptor)
  }
}


const toolchainEvidence = new Map<string, StorybookBuildInputFile>()

/** Кэширует immutable toolchain bytes по kernel identity, не consumer sources. */
function readCachedToolchainFile(path: string): Pick<StorybookBuildInputFile, "path" | "contentDigest" | "size"> {
  const canonical = canonicalExactFile(path)
  const current = statSync(canonical, {bigint: true})
  const cached = toolchainEvidence.get(canonical)
  const evidence = cached !== undefined && cached.device === current.dev.toString() &&
    cached.inode === current.ino.toString() && cached.modifiedNs === current.mtimeNs.toString() &&
    cached.size === Number(current.size)
    ? cached
    : readExactFile(canonical)
  toolchainEvidence.set(canonical, evidence)
  return Object.freeze({path: evidence.path, contentDigest: evidence.contentDigest, size: evidence.size})
}

let resolvedToolchainFiles: readonly string[] | null = null

/** Находит package manifest и runtime entry фактически установленного TypeScript. */
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

/** Устанавливает event-driven watchers и сохраняет любое релевантное изменение. */
function createChangeGuard(scope: StorybookBuildInputScope): Readonly<{
  changed(): string | null
  close(): void
}> {
  let changedPath: string | null = null
  const watchers: FSWatcher[] = []
  const mark = (root: string, filename: string | Buffer | null): void => {
    if (filename === null) {
      changedPath ??= `${root}:<unknown>`
      return
    }
    const path = resolve(root, String(filename))
    if (excluded(path, scope.excludedRoots) || ignoredWatcherPath(root, path)) return
    changedPath ??= path
  }
  try {
    for (const root of scope.guardRoots) {
      try {
        watchers.push(watch(root, {recursive: true}, (_event, filename) => mark(root, filename)))
      } catch {
        for (const directory of collectDirectories(root, scope.excludedRoots)) {
          watchers.push(watch(directory, (_event, filename) => mark(directory, filename)))
        }
      }
    }
  } catch (error) {
    for (const watcher of watchers) watcher.close()
    throw new Error("Cannot establish Storybook build input change guard", {cause: error})
  }
  return Object.freeze({
    changed(): string | null {
      return changedPath
    },
    close(): void {
      for (const watcher of watchers) watcher.close()
    },
  })
}

/** Перечисляет каталоги fallback guard без polling. */
function collectDirectories(root: string, excludedRoots: readonly string[]): readonly string[] {
  const output: string[] = []
  const ambientRoot = basename(root) === "node_modules"
  const visit = (directory: string): void => {
    if (excluded(directory, excludedRoots)) return
    output.push(directory)
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      if (!entry.isDirectory() || entry.isSymbolicLink() ||
        (ignoredDirectoryName(entry.name) && !(ambientRoot && entry.name === "node_modules"))) continue
      visit(join(directory, entry.name))
    }
  }
  visit(root)
  return Object.freeze(output)
}

/** Удаляет вложенные roots, уже полностью покрытые родительским inventory. */
function minimalRoots(values: readonly string[]): readonly string[] {
  const roots = [...new Set(values)].sort((left, right) => left.length - right.length || comparePaths(left, right))
  return Object.freeze(roots.filter((candidate, index) =>
    !roots.slice(0, index).some((root) => inside(root, candidate) && !ignoredRelativePath(root, candidate)))
    .sort(comparePaths))
}

/** Удаляет вложенные watcher roots, поскольку recursive guard не применяет inventory exclusions. */
function minimalGuardRoots(values: readonly string[]): readonly string[] {
  const roots = [...new Set(values)].sort((left, right) => left.length - right.length || comparePaths(left, right))
  return Object.freeze(roots.filter((candidate, index) =>
    !roots.slice(0, index).some((root) => inside(root, candidate) &&
      (!ignoredRelativePath(root, candidate) || basename(root) === "node_modules")))
    .sort(comparePaths))
}

/** Проверяет exact regular file без следования последнему symlink segment. */
function canonicalExactFile(value: string): string {
  const parent = realpathSync.native(dirname(resolve(value)))
  const path = join(parent, basename(value))
  const stats = lstatSync(path)
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Storybook fingerprint input must be an exact non-symlink file: ${path}`)
  }
  return path
}

/** Проверяет существующий canonical directory root. */
function canonicalDirectory(value: string): string {
  const path = realpathSync.native(resolve(value))
  if (!statSync(path).isDirectory()) throw new Error(`Storybook fingerprint root must be a directory: ${path}`)
  return path
}

/** Канонизирует ещё не созданный output path через существующего parent. */
function canonicalFuturePath(value: string): string {
  const absolute = resolve(value)
  return join(realpathSync.native(dirname(absolute)), basename(absolute))
}

/** Проверяет file existence без исключения из-за отсутствующего optional manifest candidate. */
function lstatFile(path: string): boolean {
  try {
    return lstatSync(path).isFile()
  } catch {
    return false
  }
}

/** Исключает только exact output subtree текущей операции. */
function excluded(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => inside(root, path))
}

/** Применяет одинаковые ambient directory exclusions к inventory и watcher events. */
function ignoredRelativePath(root: string, path: string): boolean {
  const local = relative(root, path)
  return local.split(sep).some(ignoredDirectoryName)
}

/** Исключает ambient installs/caches и package candidate artifacts, но не `.storybook`. */
function ignoredDirectoryName(value: string): boolean {
  return IGNORED_DIRECTORY_NAMES.has(value) || value.startsWith(".candidate-")
}

/** Watcher оставляет node_modules включённым для transient изменений resolved closure. */
function ignoredWatcherPath(root: string, path: string): boolean {
  const local = relative(root, path)
  return local.split(sep).some((segment) =>
    segment === ".git" || segment === ".cache" || segment === ".turbo" || segment === "coverage")
}

/** Стабильно сериализует JSON-like descriptor независимо от insertion order. */
function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeJson(value))
}

/** Рекурсивно сортирует object keys и отклоняет non-JSON values. */
function normalizeJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Storybook fingerprint cannot serialize a non-finite number")
    return value
  }
  if (Array.isArray(value)) return value.map(normalizeJson)
  if (!isObject(value)) {
    if (value === undefined) return null
    throw new TypeError(`Storybook fingerprint cannot serialize ${typeof value}`)
  }
  return Object.fromEntries(Object.keys(value).sort(comparePaths).map((key) => [key, normalizeJson(value[key])]))
}

/** Вычисляет SHA-256 UTF-8 canonical payload. */
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

/** Создаёт детерминированную ошибку race attestation. */
function concurrentChangeError(path?: string): Error {
  return new Error(`Storybook build inputs changed during compilation${path === undefined ? "" : `: ${path}`}`)
}

/** Проверяет SHA-256 text. */
function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
}

/** Проверяет абсолютный canonical-looking path transport value. */
function isAbsoluteString(value: unknown): value is string {
  return typeof value === "string" && isAbsolute(value)
}

/** Проверяет transport list на absolute, deterministic и unique порядок. */
function canonicalPathList(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || !value.every(isAbsoluteString)) return false
  return value.every((path, index) => index === 0 || comparePaths(value[index - 1]!, path) < 0)
}

/** Проверяет bigint transport as decimal string. */
function decimal(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/u.test(value)
}

/** Отличает JSON object от массива и примитива. */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** Проверяет lexical containment с учётом case-insensitive host paths. */
function inside(root: string, path: string): boolean {
  const local = relative(comparablePath(root), comparablePath(path))
  return local === "" || (!local.startsWith(`..${sep}`) && local !== ".." && !local.startsWith(sep))
}

/** Нормализует сравнение host paths без изменения возвращаемой identity. */
function comparablePath(value: string): string {
  const path = resolve(value)
  return process.platform === "darwin" || process.platform === "win32" ? path.toLowerCase() : path
}

/** Детерминирует path order. */
function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
