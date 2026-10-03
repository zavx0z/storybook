import {lstatSync, realpathSync, statSync} from "node:fs"
import {basename, dirname, join, resolve} from "node:path"

/** Проверяет обычный файл без следования символьной ссылке в последнем сегменте. */
export function canonicalExactFile(value: string): string {
  const parent = realpathSync.native(dirname(resolve(value)))
  const path = join(parent, basename(value))
  const stats = lstatSync(path)
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Storybook build input must be an exact non-symlink file: ${path}`)
  }
  return path
}

/** Разрешает существующий каталог в его канонический физический путь. */
export function canonicalDirectory(value: string): string {
  const path = realpathSync.native(resolve(value))
  if (!statSync(path).isDirectory()) throw new Error(`Storybook build root must be a directory: ${path}`)
  return path
}
