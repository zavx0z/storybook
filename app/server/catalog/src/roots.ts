import {realpathSync} from "node:fs"
import {isAbsolute, relative, resolve, sep} from "node:path"

/** Отозванный или перенесённый корень требует нового индекса без чтения старых документов. */
export class MetadataRootNotTrusted extends Error {}

/** Доверие поступает только от хоста; сохранённое дерево не объявляет новые корни. */
export function canonicalMetadataRoots(roots: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(roots.map(root => realpathSync(root)))])
}

export function containsMetadataPath(root: string, path: string): boolean {
  const local = relative(root, path)
  return !isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`)
}

/** Владелец находится в объявленном checkout и не использует символический alias. */
export function assertMetadataOwner(roots: readonly string[], owner: string, canonical = true): void {
  if (!isAbsolute(owner) || !roots.some(root => containsMetadataPath(root, owner))) {
    throw new MetadataRootNotTrusted("Metadata owner is outside trusted roots")
  }
  if (resolve(owner) !== owner || canonical && realpathSync(owner) !== owner) throw new Error("Metadata owner must be a canonical directory")
}
