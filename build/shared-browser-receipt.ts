import {createHash, randomUUID} from "node:crypto"
import {constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from "node:fs"
import {isAbsolute, join, relative} from "node:path"
import {fileURLToPath} from "node:url"
import {computeStorybookSharedBuildInputFingerprint, parseStorybookBuildInputFingerprint, sameStorybookBuildInputFingerprint} from "./build-input-fingerprint.ts"
import type {SharedBrowserAssets} from "./shared-browser-assets.ts"
import type {SharedBrowserBuildInput} from "./types/shared-browser.ts"
import {validateStorybookSharedBrowserIdentity} from "./shared-module-identity.ts"

/**
Восстанавливает общую оболочку только при совпадении исходников и файлов результата.

@param input - Текущие entrypoints и каталоги сборки; данные receipt не выбирают владельца.

@returns Подтверждённые assets либо null для старого, отсутствующего или повреждённого кэша.
Проверка не запускает компилятор и не исполняет исходники.
*/
export function readSharedBrowserReceipt(input: SharedBrowserBuildInput): SharedBrowserAssets | null {
  let fd: number | undefined
  try {
    fd = openSync(join(input.root, "receipt.json"), constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > 8 * 1024 * 1024) return null
    const receipt = JSON.parse(readFileSync(fd, "utf8"))
    const assets = receipt.assets as SharedBrowserAssets
    const saved = parseStorybookBuildInputFingerprint(assets?.inputFingerprint)
    if (receipt.version !== 1 || assets.root !== input.root || saved === null ||
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
    const browserIdentity = validateStorybookSharedBrowserIdentity(assets.browserIdentity)
    if (!paths.has(browserIdentity.packageEntryUrl.slice("/__storybook/shared/".length)) ||
      browserIdentity.modules.some(({url}) => !paths.has(url.slice("/__storybook/shared/".length)))) return null
    if (!Array.isArray(assets.authorStyleSheets) || assets.authorStyleSheets.some(style =>
      typeof style.specifier !== "string" || !paths.has(style.url) ||
      !assets.artifactDigests?.some(artifact => artifact.path === style.url && artifact.digest === style.contentDigest))) return null
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
export function saveSharedBrowserReceipt(assets: SharedBrowserAssets): void {
  const path = join(assets.root, "receipt.json")
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify({version: 1, assets}), {mode: 0o600, flag: "wx"})
    renameSync(temporary, path)
  } finally { rmSync(temporary, {force: true}) }
}
