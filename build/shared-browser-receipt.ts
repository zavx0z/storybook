import {createHash, randomUUID} from "node:crypto"
import {constants, closeSync, fstatSync, lstatSync, mkdirSync, existsSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from "node:fs"
import {isAbsolute, join, relative} from "node:path"
import {fileURLToPath} from "node:url"
import {computeStorybookSharedBuildInputFingerprint, parseStorybookBuildInputFingerprint, sameStorybookBuildInputFingerprint} from "./build-input-fingerprint.ts"
import type {SharedBrowserAssets} from "./shared-browser-assets.ts"
import type {SharedBrowserBuildInput} from "./types/shared-browser.ts"
import {validateStorybookSharedBrowserIdentity} from "./shared-module-identity.ts"

/**
Восстанавливает общую оболочку с проверкой файлов результата.
Явный check также сверяет исходники; запуск сервера читает последнюю готовую версию.

@param input - Текущие entrypoints и каталоги сборки; данные receipt не выбирают владельца.

@param verifyInputs - Сверять текущие исходники для compiler cache; false читает готовую оболочку для страницы.

@returns Подтверждённые assets либо null для старого, отсутствующего или повреждённого кэша.
Проверка не запускает компилятор и не исполняет исходники.
*/
export function readSharedBrowserReceipt(input: SharedBrowserBuildInput, verifyInputs = true): SharedBrowserAssets | null {
  if (input.sharedKernel !== undefined && !/^[a-f0-9]{64}$/u.test(input.sharedKernel.epoch)) return null
  const path = join(input.root, input.sharedKernel ? `hosts/${input.sharedKernel.epoch}.json` : "candidate.json")
  return readReceipt(input, path, verifyInputs) ?? (input.sharedKernel ? null : readReceipt(input, join(input.root, "receipt.json"), verifyInputs))
}

/** Читает только опубликованную оболочку без выбора более нового кандидата. */
export function readPublishedSharedBrowserReceipt(input: SharedBrowserBuildInput): SharedBrowserAssets | null {
  return readReceipt(input, join(input.root, "receipt.json"), false)
}

/** Сохраняет кандидата, не меняя опубликованный набор и не отправляя browser events. */
export function saveSharedBrowserCandidate(assets: SharedBrowserAssets, latest: boolean): void {
  saveSharedBrowserReceipt(assets, false)
  if (latest) writeReceipt(join(assets.root, "candidate.json"), assets)
}

/** Читает сохранённый kernel по проверенным immutable артефактам, независимо от нынешних исходников. */
export function readSharedBrowserEpoch(root: string, epoch: string, hostEpoch?: string): SharedBrowserAssets | null {
  if (!/^[a-f0-9]{64}$/u.test(epoch)) throw new Error("Invalid shared kernel epoch")
  if (hostEpoch !== undefined && !/^[a-f0-9]{64}$/u.test(hostEpoch)) throw new Error("Invalid shared host epoch")
  const input = {root, toolRoot: root, landingEntryPath: "", fallbackEntryPath: "", stagingDirectory: root}
  const saved = readReceipt(input, join(root, "hosts", hostEpoch === undefined ? `${epoch}.json` : `${epoch}/${hostEpoch}.json`), false)
  const latest = saved ?? (hostEpoch === undefined ? readReceipt(input, join(root, "receipt.json"), false) : null)
  return latest?.browserIdentity?.epoch === epoch ? latest : null
}

function readReceipt(input: SharedBrowserBuildInput, path: string, verifyInputs: boolean): SharedBrowserAssets | null {
  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > 8 * 1024 * 1024) return null
    const receipt = JSON.parse(readFileSync(fd, "utf8"))
    const assets = receipt.assets as SharedBrowserAssets
    const saved = parseStorybookBuildInputFingerprint(assets?.inputFingerprint)
    if (receipt.version !== 1 || assets.root !== input.root || (verifyInputs && saved === null) ||
      !Array.isArray(assets.artifactDigests) || assets.artifactDigests.length === 0 ||
      !Array.isArray(assets.dependencyRealpaths) || assets.dependencyRealpaths.some(path => typeof path !== "string" || !isAbsolute(path))) return null
    const paths = new Set<string>()
    for (const artifact of assets.artifactDigests) {
      if (typeof artifact.path !== "string" || isAbsolute(artifact.path) || !/^[a-f0-9]{64}$/u.test(artifact.digest)) return null
      const path = join(input.root, artifact.path)
      const local = relative(realpathSync(input.root), realpathSync(path))
      const info = lstatSync(path)
      if (!local || local.startsWith("..") || isAbsolute(local) || !info.isFile() || info.isSymbolicLink()) return null
      if (createHash("sha256").update(readFileSync(path)).digest("hex") !== artifact.digest) return null
      paths.add(artifact.path)
    }
    if (!paths.has(assets.landingEntry) || !paths.has(assets.fallbackEntry)) return null
    if (assets.browserIdentity === undefined) return null
    const browserIdentity = validateStorybookSharedBrowserIdentity(assets.browserIdentity, verifyInputs && input.sharedKernel === undefined)
    if (!paths.has(browserIdentity.packageEntryUrl.slice("/__storybook/shared/".length)) ||
      browserIdentity.modules.some(({url}) => !paths.has(url.slice("/__storybook/shared/".length))) ||
      browserIdentity.packageHostUrl !== undefined && !paths.has(browserIdentity.packageHostUrl.slice("/__storybook/shared/".length)) ||
      assets.bootstrapEntry !== undefined && !paths.has(assets.bootstrapEntry)) return null
    if (!Array.isArray(assets.authorStyleSheets) || assets.authorStyleSheets.some(style =>
      typeof style.specifier !== "string" || !paths.has(style.url) ||
      !assets.artifactDigests?.some(artifact => artifact.path === style.url && artifact.digest === style.contentDigest))) return null
    if (!verifyInputs) {
      const {inputFingerprint: _saved, ...prepared} = assets
      return Object.freeze({...prepared, browserIdentity, ...(saved === null ? {} : {inputFingerprint: saved})})
    }
    if (saved === null) return null
    const current = computeStorybookSharedBuildInputFingerprint({
      ...input,
      packageEntryPath: input.packageEntryPath ?? fileURLToPath(
        new URL("../runtime/page-entry.ts", import.meta.url),
      ),
      outputDirectory: input.root,
      additionalFilePaths: saved.files.map(file => file.path),
      resolutionDirectories: saved.resolutionDirectories,
    })
    return sameStorybookBuildInputFingerprint(saved, current)
      ? Object.freeze({...assets, browserIdentity, cacheHit: true})
      : null
  } catch { return null }
  finally { if (fd !== undefined) closeSync(fd) }
}

/**
Атомарно сохраняет метаданные уже проверенных и опубликованных shared assets.

@param assets - Результат успешной сборки с input fingerprint и digest каждого выходного файла.

@throws Ошибка записи или atomic rename; прежний receipt сохраняется до успешной замены.
*/
export function saveSharedBrowserReceipt(assets: SharedBrowserAssets, current = true): void {
  const epoch = assets.browserIdentity?.epoch
  if (!epoch || !/^[a-f0-9]{64}$/u.test(epoch)) throw new Error("Shared receipt requires a kernel identity")
  const directory = join(assets.root, "hosts")
  mkdirSync(directory, {recursive: true})
  if (current && existsSync(join(assets.root, "receipt.json"))) {
    const previous = readReceipt({root: assets.root, toolRoot: assets.root, landingEntryPath: "", fallbackEntryPath: "", stagingDirectory: assets.root},
      join(assets.root, "receipt.json"), false)
    if (previous?.browserIdentity) {
      const previousEpoch = previous.browserIdentity.epoch
      mkdirSync(join(directory, previousEpoch), {recursive: true})
      writeReceipt(join(directory, previousEpoch, `${previous.browserIdentity.hostModuleEpoch}.json`), previous)
      const latestPath = join(directory, `${previousEpoch}.json`)
      if (!existsSync(latestPath)) writeReceipt(latestPath, previous)
    }

  }
  mkdirSync(join(directory, epoch), {recursive: true})
  writeReceipt(join(directory, epoch, `${assets.browserIdentity!.hostModuleEpoch}.json`), assets)
  writeReceipt(join(directory, `${epoch}.json`), assets)
  if (current) writeReceipt(join(assets.root, "receipt.json"), assets)
}

/** Atomic запись отдельно текущего указателя и сохраняемых платформенных вариантов. */
function writeReceipt(path: string, assets: SharedBrowserAssets): void {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify({version: 1, assets}), {mode: 0o600, flag: "wx"})
    renameSync(temporary, path)
  } finally { rmSync(temporary, {force: true}) }
}
