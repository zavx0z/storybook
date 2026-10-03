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
} from "node:fs"
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from "node:path"
import type {BuildInputFile} from "../contract/fingerprint"
import type {BuildInputs} from "../contract"
import type {BuildInputPlan, BuildInputScope} from "./plan"
import type {BuildInputAttestation} from "./attestation"
import {PROTOCOL} from "./protocol"

type BuildInputFingerprint = BuildInputs.Output
type BuildInputPlanInput = BuildInputs.Input

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".idea",
  "node_modules",
  ".cache",
  ".turbo",
  "coverage",
  "artifacts",
  ".artifacts",
])
/** Канонизирует generic plan до вычисления digest. */
export function createPlan(
  input: BuildInputPlanInput,
): BuildInputPlan {
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

/** Фиксирует содержимое и stat identity входов на границах одной явной проверки. */
export async function attest(
  plan: BuildInputPlan,
): Promise<BuildInputAttestation> {
  const started = BigInt(Date.now()) * 1_000_000n
  const before = computeFingerprint(plan)
  const paths = new Set([...scopeInventory(plan.scope).paths, ...before.files.map(file => file.path)])
  const markers = new Map([...paths].map(path => [path, inputMarker(path)]))
  let finished = false
  return Object.freeze({
    before,
    /** Завершает session, сверяя исходные markers и exact resolver closure. */
    async complete(additionalFilePaths: readonly string[] = []): Promise<BuildInputFingerprint> {
      if (finished) throw new Error("Storybook build input attestation is already complete")
      finished = true
      const additional = additionalFilePaths.map(canonicalExactFile)
      const outside = additional.find(path => !plan.scope.guardRoots.some(root => inside(root, path)))
      if (outside) throw new Error(`Storybook compiled input escaped attested owner roots: ${outside}`)
      const after = computeFingerprint(plan)
      for (const [path, marker] of markers) {
        if (inputMarker(path) !== marker) throw concurrentChangeError(path)
      }
      if (!same(before, after)) {
        const added = scopeInventory(plan.scope).paths.find(path => !paths.has(path))
        throw concurrentChangeError(added)
      }
      for (const path of additional) {
        if (!markers.has(path) && statSync(path, {bigint: true}).ctimeNs >= started) throw concurrentChangeError(path)
      }
      const final = additional.length === 0 ? after
        : computeFingerprint(extendPlan(plan, additional))
      for (const [path, marker] of markers) {
        if (inputMarker(path) !== marker) throw concurrentChangeError(path)
      }
      return final
    },
    /** Закрывает session без подтверждения результата операции. */
    dispose(): void { finished = true },
  })
}

/** Замена файла и возврат прежних байтов остаются изменением проверяемого состояния. */
function inputMarker(path: string): string {
  try {
    const value = lstatSync(path, {bigint: true})
    return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(":")
  } catch { return "missing" }
}

/** Добавляет attested metafile closure, не меняя identity/toolchain/ABI владельца. */
function extendPlan(
  plan: BuildInputPlan,
  additionalFilePaths: readonly string[],
): BuildInputPlan {
  return createPlan({
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



/** Неполное evidence или неизвестная версия никогда не считается cache hit. */
export function parse(
  value: unknown,
): BuildInputFingerprint | null {
  if (!isObject(value) || value.protocol !== PROTOCOL ||
    !digest(value.digest) || !digest(value.descriptorDigest) || !digest(value.sourceDigest) ||
    !digest(value.toolchainDigest) || !digest(value.validationDigest) ||
    !canonicalPathList(value.roots) ||
    !canonicalPathList(value.resolutionDirectories) ||
    !canonicalPathList(value.directories) ||
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
    protocol: PROTOCOL,
    descriptorDigest: value.descriptorDigest,
    sourceDigest: value.sourceDigest,
    toolchainDigest: value.toolchainDigest,
    validationDigest: value.validationDigest,
  }))
  if (value.digest !== expectedDigest) return null
  return Object.freeze({
    protocol: PROTOCOL,
    digest: value.digest,
    descriptorDigest: value.descriptorDigest,
    sourceDigest: value.sourceDigest,
    toolchainDigest: value.toolchainDigest,
    validationDigest: value.validationDigest,
    roots: Object.freeze([...value.roots]),
    resolutionDirectories: Object.freeze([...value.resolutionDirectories]),
    directories: Object.freeze([...value.directories]),
    files: Object.freeze(files),
  })
}

/**
Возвращает пути проверенных входов для явной сверки общей оболочки.

Файлы определяют содержимое, а директории — создание, удаление и смену
resolution candidates. Helper не открывает compiler context и не повторяет
inventory policy; invalid/old evidence возвращает `null`.
*/
export function paths(
  value: unknown,
): readonly string[] | null {
  const fingerprint = parse(value)
  if (fingerprint === null) return null
  return Object.freeze([...new Set([
    ...fingerprint.files.map(({path}) => path),
    ...fingerprint.directories,
  ])].sort(comparePaths))
}

/** Сравнивает только валидное versioned evidence; inode/mtime не являются restart key. */
export function same(left: unknown, right: unknown): boolean {
  const first = parse(left)
  const second = parse(right)
  return first !== null && second !== null &&
    first.digest === second.digest &&
    first.descriptorDigest === second.descriptorDigest &&
    first.sourceDigest === second.sourceDigest &&
    first.toolchainDigest === second.toolchainDigest &&
    first.validationDigest === second.validationDigest
}

/** Строит category digests из одного отсортированного snapshot файлов. */
export function computeFingerprint(
  plan: BuildInputPlan,
  cache?: FingerprintComputationCache,
  trustCache = false,
): BuildInputFingerprint {
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
  const directories = Object.freeze([...new Set([
    ...inventory.directories.map(({path}) => path),
    ...scope.resolutionDirectories,
  ])].sort(comparePaths))
  const sourceDigest = hash(stableStringify({
    roots: scope.roots,
    inventory: inventory.paths,
    resolutionDirectories: resolutionInventory,
    files: files.map(({path, contentDigest, size}) => ({path, contentDigest, size})),
  }))
  const toolchainDigest = hash(stableStringify({
    bun: Bun.version,
    executable: readCachedToolchainFile(process.execPath),
    typescript: plan.toolchainFiles.map(readCachedToolchainFile),
    adapter: files.find(({path}) => path === plan.compilerAdapterPath)?.contentDigest ?? null,
  }))
  const validationDigest = hash(stableStringify({
    fingerprint: PROTOCOL,
    ...plan.validationAbi,
  }))
  const result = {
    protocol: PROTOCOL,
    descriptorDigest,
    sourceDigest,
    toolchainDigest,
    validationDigest,
    roots: scope.roots,
    resolutionDirectories: scope.resolutionDirectories,
    directories,
    files,
  } as const
  const digestValue = hash(stableStringify({
    protocol: PROTOCOL,
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
  evidence: BuildInputFile
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
export type FingerprintComputationCache = {
  files: Map<string, CachedFileEvidence>
  inventories: Map<string, CachedInventory>
}

/** Повторно использует inventory одинакового owner scope после дешёвой проверки каталогов. */
function scopeInventory(
  scope: BuildInputScope,
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
): BuildInputFile {
  const canonical = canonicalExactFile(path)
  const cached = cache.get(canonical)
  if (trustCache && cached !== undefined) return cached.evidence
  const current = lstatSync(canonical, {bigint: true})
  if (cached !== undefined && current.isFile() && !current.isSymbolicLink() &&
    cached.evidence.device === current.dev.toString() &&
    cached.evidence.inode === current.ino.toString() && cached.evidence.size === Number(current.size) &&
    cached.evidence.modifiedNs === current.mtimeNs.toString() && cached.changedNs === current.ctimeNs.toString()) {
    return cached.evidence
  }
  const exact = readExactFileWithMarker(canonical)
  cache.set(canonical, exact)
  return exact.evidence
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

/** Отбирает TypeScript/JavaScript semantic inputs внутри заданных compiler roots. */
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
function readDirectoryInventory(path: string): Readonly<{
  path: string
  entries: readonly string[]
}> {
  const before = directoryEvidence(path)
  const entries = readdirSync(path, {withFileTypes: true})
    .map((entry) => `${entry.isDirectory() ? "d" : entry.isFile() ? "f" : entry.isSymbolicLink() ? "l" : "o"}:${entry.name}`)
    .sort(comparePaths)
  const after = directoryEvidence(path)
  if (!sameDirectoryMarkers(before, after)) throw concurrentChangeError(path)
  return Object.freeze({path, entries: Object.freeze(entries)})
}

/** Читает bytes через O_NOFOLLOW и сверяет identity до/после чтения. */
function readExactFile(path: string): BuildInputFile {
  return readExactFileWithMarker(path).evidence
}

/** Bytes и ctime кеша происходят из одного подтверждённого fstat window. */
function readExactFileWithMarker(path: string): CachedFileEvidence {
  const canonical = canonicalExactFile(path)
  const descriptor = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = fstatSync(descriptor, {bigint: true})
    const bytes = readFileSync(descriptor)
    const after = fstatSync(descriptor, {bigint: true})
    const current = lstatSync(canonical, {bigint: true})
    if (!before.isFile() || before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
      !current.isFile() || current.isSymbolicLink() ||
      after.dev !== current.dev || after.ino !== current.ino ||
      after.size !== current.size || after.mtimeNs !== current.mtimeNs || after.ctimeNs !== current.ctimeNs) {
      throw concurrentChangeError(canonical)
    }
    return Object.freeze({
      evidence: Object.freeze({
        path: canonical,
        contentDigest: createHash("sha256").update(bytes).digest("hex"),
        size: Number(after.size),
        device: after.dev.toString(),
        inode: after.ino.toString(),
        modifiedNs: after.mtimeNs.toString(),
      }),
      changedNs: after.ctimeNs.toString(),
    })
  } finally {
    closeSync(descriptor)
  }
}


const toolchainEvidence = new Map<string, BuildInputFile>()

/** Кэширует immutable toolchain bytes по kernel identity, не consumer sources. */
function readCachedToolchainFile(path: string): Pick<BuildInputFile, "path" | "contentDigest" | "size"> {
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

/** Удаляет вложенные roots, уже полностью покрытые родительским inventory. */
function minimalRoots(values: readonly string[]): readonly string[] {
  const roots = [...new Set(values)].sort((left, right) => left.length - right.length || comparePaths(left, right))
  return Object.freeze(roots.filter((candidate, index) =>
    !roots.slice(0, index).some((root) => inside(root, candidate) && !ignoredRelativePath(root, candidate)))
    .sort(comparePaths))
}

/** Удаляет вложенные корни допустимых зависимостей. */
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

/** Исключает служебные директории из снимка исходников. */
function ignoredRelativePath(root: string, path: string): boolean {
  const local = relative(root, path)
  return local.split(sep).some(ignoredDirectoryName)
}

/** Исключает состояние IDE, установленные зависимости, кэши и артефакты из исходников пакета. */
function ignoredDirectoryName(value: string): boolean {
  return IGNORED_DIRECTORY_NAMES.has(value) || value.startsWith(".candidate-")
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
