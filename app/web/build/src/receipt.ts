import {createHash, randomUUID} from "node:crypto"
import {constants, closeSync, fstatSync, lstatSync, mkdirSync, existsSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from "node:fs"
import {isAbsolute, join, relative} from "node:path"
import type {SharedBrowserAssets} from "../contract/assets"
import type {SharedBrowserBuildInput} from "../contract/build"
import Environment from "@storybook-tech-build/environment"

/** Максимум сериализованных shared assets и их receipt; транспорт worker использует ту же границу. */
export const STORYBOOK_SHARED_ASSETS_MAX_BYTES = 8 * 1024 * 1024

/** Читает только опубликованную оболочку без выбора более нового кандидата. */
export function readPublishedSharedBrowserReceipt(input: Omit<SharedBrowserBuildInput, "sharedKernel" | "kernelArtifacts">): SharedBrowserAssets | null {
  return readReceipt(input, join(input.root, "receipt.json"))
}

/** Сохраняет кандидата, не меняя опубликованный набор и не отправляя browser events. */
export function saveSharedBrowserCandidate(assets: SharedBrowserAssets): void {
  saveSharedBrowserReceipt(assets, false)
}

/**
Читает сохранённый kernel по проверенным immutable артефактам, независимо от нынешних исходников.
При отказе onRejected сохраняет причину: отсутствие файла, нарушение хеша или metadata.
Отказ не заменяет повреждённую платформу текущими зависимостями.
*/
export function readSharedBrowserEpoch(
  root: string,
  epoch: string,
  hostEpoch?: string,
  onRejected?: (reason: string) => void,
): SharedBrowserAssets | null {
  if (!/^[a-f0-9]{64}$/u.test(epoch)) throw new Error("Invalid shared kernel epoch")
  if (hostEpoch !== undefined && !/^[a-f0-9]{64}$/u.test(hostEpoch)) throw new Error("Invalid shared host epoch")
  const input = {root, toolRoot: root, landingEntryPath: "", fallbackEntryPath: "", stagingDirectory: root}
  if (hostEpoch !== undefined) {
    const exact = readReceipt(input, join(root, "hosts", epoch, `${hostEpoch}.json`), onRejected)
    return exact?.browserIdentity?.epoch === epoch && exact.browserIdentity.hostModuleEpoch === hostEpoch ? exact : null
  }
  const current = readReceipt(input, join(root, "receipt.json"), onRejected)
  if (current?.browserIdentity?.epoch === epoch) return current
  const previous = readReceipt(input, join(root, "hosts", `${epoch}.json`), onRejected)
  if (previous?.browserIdentity?.epoch === epoch) return previous
  return null
}

function readReceipt(
  input: Omit<SharedBrowserBuildInput, "sharedKernel" | "kernelArtifacts">,
  path: string,
  onRejected?: (reason: string) => void,
): SharedBrowserAssets | null {
  const reject = (reason: string): null => {
    onRejected?.(`${relative(input.root, path)}: ${reason}`)
    return null
  }
  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = fstatSync(fd)
    if (!info.isFile() || info.size > STORYBOOK_SHARED_ASSETS_MAX_BYTES) return reject("Недопустимый файл receipt")
    const receipt = JSON.parse(readFileSync(fd, "utf8"))
    const assets = receipt.assets as SharedBrowserAssets
    if (receipt.version !== 1 || assets.root !== input.root ||
      !Array.isArray(assets.artifactDigests) || assets.artifactDigests.length === 0) return reject("Некорректные metadata receipt или другой root")
    const paths = new Set<string>()
    for (const artifact of assets.artifactDigests) {
      if (typeof artifact.path !== "string" || isAbsolute(artifact.path) || !/^[a-f0-9]{64}$/u.test(artifact.digest)) return reject("Некорректное объявление артефакта")
      const path = join(input.root, artifact.path)
      const local = relative(realpathSync(input.root), realpathSync(path))
      const info = lstatSync(path)
      if (!local || local.startsWith("..") || isAbsolute(local) || !info.isFile() || info.isSymbolicLink()) return reject(`Артефакт не принадлежит архиву: ${artifact.path}`)
      if (createHash("sha256").update(readFileSync(path)).digest("hex") !== artifact.digest) return reject(`Хеш артефакта не совпадает: ${artifact.path}`)
      paths.add(artifact.path)
    }
    if (!paths.has(assets.landingEntry) || !paths.has(assets.fallbackEntry)) return reject("Нет артефактов входа страницы")
    if (assets.browserIdentity === undefined) return reject("Нет browser identity")
    const browserIdentity = Environment.validate(assets.browserIdentity)
    if (!paths.has(browserIdentity.packageEntryUrl.slice("/__storybook/shared/".length)) ||
      browserIdentity.modules.some(({url}) => !paths.has(url.slice("/__storybook/shared/".length))) ||
      assets.bootstrapEntry !== undefined && !paths.has(assets.bootstrapEntry)) return reject("Identity ссылается на отсутствующий артефакт")
    if (!Array.isArray(assets.authorStyleSheets) || assets.authorStyleSheets.some(style =>
      typeof style.specifier !== "string" || !paths.has(style.url) ||
      !assets.artifactDigests?.some(artifact => artifact.path === style.url && artifact.digest === style.contentDigest))) return reject("Нет подтверждённых артефактов авторских стилей")
    return Object.freeze({...assets, browserIdentity})
  } catch (error) { return reject(error instanceof Error ? error.message : String(error)) }
  finally { if (fd !== undefined) closeSync(fd) }
}

/**
Атомарно сохраняет метаданные уже проверенных и опубликованных shared assets.

@param assets - Результат успешной сборки с digest каждого выходного файла.

@throws Ошибка записи или atomic rename; прежний receipt сохраняется до успешной замены.
*/
export function saveSharedBrowserReceipt(assets: SharedBrowserAssets, current = true): void {
  const epoch = assets.browserIdentity?.epoch
  if (!epoch || !/^[a-f0-9]{64}$/u.test(epoch)) throw new Error("Shared receipt requires a kernel identity")
  const directory = join(assets.root, "hosts")
  mkdirSync(directory, {recursive: true})
  if (current && existsSync(join(assets.root, "receipt.json"))) {
    const previous = readReceipt({root: assets.root, toolRoot: assets.root, landingEntryPath: "", fallbackEntryPath: "", stagingDirectory: assets.root},
      join(assets.root, "receipt.json"))
    if (previous?.browserIdentity) {
      const previousEpoch = previous.browserIdentity.epoch
      mkdirSync(join(directory, previousEpoch), {recursive: true})
      writeReceipt(join(directory, previousEpoch, `${previous.browserIdentity.hostModuleEpoch}.json`), previous)
      const latestPath = join(directory, `${previousEpoch}.json`)
      writeReceipt(latestPath, previous)
    }

  }
  mkdirSync(join(directory, epoch), {recursive: true})
  writeReceipt(join(directory, epoch, `${assets.browserIdentity!.hostModuleEpoch}.json`), assets)
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
