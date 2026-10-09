import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs"
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from "node:path"

import type {StorybookPackageOwner} from "../contract/owner"

/**
Находит ближайшего именованного владельца исходника. Вложенный package.json без
name задаёт область настроек модуля (например, ESM/CJS в npm-зависимости), но не
объявляет отдельную идентичность. Явно выбранный корень проверяется строго через
readStorybookPackageRoot.

@param path - Разрешённый путь исходного файла.

@returns Ближайший именованный владелец либо null до границы node_modules или файловой системы. Установленная зависимость не присваивается проекту-потребителю.

@throws Ошибка чтения/JSON либо некорректное явно заданное имя; эти отказы не скрываются поиском родителя.
*/
export function readStorybookPackageOwner(path: string): StorybookPackageOwner | null {
  let directory = dirname(resolve(path))
  while (true) {
    const manifestPath = join(directory, "package.json")
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
      if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw new TypeError(`Storybook owner manifest must be an object: ${manifestPath}`)
      }
      if (Object.hasOwn(manifest, "name")) return readStorybookPackageRoot(directory)
    }
    if (basename(directory) === "node_modules") return null
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

/** Reads package identity from its canonical directory and exact manifest inode. */
export function readStorybookPackageRoot(root: string): StorybookPackageOwner {
  const canonicalRoot = realpathSync.native(resolve(root))
  const manifestPath = join(canonicalRoot, "package.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new TypeError(`Storybook owner package has no name: ${manifestPath}`)
  }
  const metadata = statSync(manifestPath)
  if (!metadata.isFile()) throw new TypeError(`Storybook owner manifest must be a file: ${manifestPath}`)
  return Object.freeze({
    manifestIdentity: `${metadata.dev}:${metadata.ino}`,
    name: manifest.name,
    root: canonicalRoot,
  })
}

/** True only for two directory spellings backed by the same exact package manifest inode. */
export function sameStorybookPackageOwner(leftRoot: string, rightRoot: string): boolean {
  const left = readStorybookPackageRoot(leftRoot)
  const right = readStorybookPackageRoot(rightRoot)
  return left.name === right.name && left.manifestIdentity === right.manifestIdentity
}

/** Chooses the declared checkout over its attested node_modules hardlink mirror. */
export function preferredStorybookPackageRoot(leftRoot: string, rightRoot: string): string {
  const left = readStorybookPackageRoot(leftRoot)
  const right = readStorybookPackageRoot(rightRoot)
  if (left.name !== right.name || left.manifestIdentity !== right.manifestIdentity) {
    throw new Error(`Storybook package roots do not share one physical identity: ${left.root} and ${right.root}`)
  }
  const leftInstalled = pathContainsNodeModules(left.root)
  const rightInstalled = pathContainsNodeModules(right.root)
  if (leftInstalled !== rightInstalled) return leftInstalled ? right.root : left.root
  return left.root
}

/** Maps one mirror source to the preferred root after package and file inode attestation. */
export function canonicalizeStorybookPackageFile(ownerRoot: string, path: string): string {
  const canonical = tryCanonicalizeStorybookPackageFile(ownerRoot, path)
  if (canonical === null) {
    throw new Error(`Resolved Storybook owner source has a different package identity: ${resolve(path)} and ${resolve(ownerRoot)}`)
  }
  return canonical
}

/** Returns null for a foreign same-name package, but rejects a corrupt attested mirror. */
export function tryCanonicalizeStorybookPackageFile(ownerRoot: string, path: string): string | null {
  const owner = readStorybookPackageRoot(ownerRoot)
  const resolvedPath = join(realpathSync.native(dirname(resolve(path))), basename(path))
  const installed = readStorybookPackageOwner(resolvedPath)
  if (installed === null) return null
  if (installed.name !== owner.name || installed.manifestIdentity !== owner.manifestIdentity) {
    return null
  }
  if (installed.root === owner.root) return resolvedPath
  const relativePath = relative(installed.root, resolvedPath)
  if (relativePath === "" || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Resolved Storybook owner source escaped package ${owner.name}: ${resolvedPath}`)
  }
  const canonicalPath = resolve(owner.root, relativePath)
  if (!existsSync(canonicalPath)) {
    throw new Error(`Resolved Storybook owner mirror has no canonical file: ${canonicalPath}`)
  }
  const resolvedFile = statSync(resolvedPath)
  const canonicalFile = statSync(canonicalPath)
  if (!resolvedFile.isFile() || !canonicalFile.isFile() ||
    resolvedFile.dev !== canonicalFile.dev || resolvedFile.ino !== canonicalFile.ino) {
    throw new Error(`Resolved Storybook owner file identity mismatch: ${resolvedPath} and ${canonicalPath}`)
  }
  return canonicalPath
}

function pathContainsNodeModules(path: string): boolean {
  return path.split(sep).includes("node_modules")
}
