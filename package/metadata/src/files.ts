import {randomUUID} from "node:crypto"
import {lstatSync, readFileSync, realpathSync} from "node:fs"
import {lstat, mkdir, readFile, realpath, rename, unlink, writeFile} from "node:fs/promises"
import {join, resolve} from "node:path"

/** Читает точный документ владельца, не проходя через символические ссылки. */
export function readDocument(root: string, name: string): string {
  const path = join(root, "meta/data", name)
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || realpathSync(path) !== path) throw new Error("Metadata must be an exact file")
  return readFileSync(path, "utf8")
}

/** Публикует документ атомарно, сохраняя файл и mtime неизменного результата. */
export async function writeDocument(root: string, name: string, text: string): Promise<boolean> {
  if (await realpath(root) !== resolve(root)) throw new Error("Владелец meta должен быть каноническим каталогом")
  for (const directory of [join(root, "meta"), join(root, "meta/data")]) {
    await mkdir(directory).catch(error => { if (error.code !== "EEXIST") throw error })
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Каталог meta не может быть символической ссылкой")
  }
  const path = join(root, "meta/data", name)
  const info = await lstat(path).catch(error => {
    if (error.code !== "ENOENT") throw error
    return null
  })
  if (info !== null && (!info.isFile() || info.isSymbolicLink())) throw new Error("Документ meta должен быть обычным файлом")
  const previous = await readFile(path, "utf8").catch(error => {
    if (error.code !== "ENOENT") throw error
    return null
  })
  if (previous === text) return false
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text, {flag: "wx"})
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error })
  }
  return true
}
