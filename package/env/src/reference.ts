import {dirname, relative, resolve, isAbsolute, sep} from "node:path"
import {existsSync, readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import type {StorybookPackageEnv as Contract} from "../contract"

/** Преобразует адрес метаданных хоста в переносимую ссылку без чтения содержимого. */
export function reference(source: Contract.Output["rules"][string], directory?: string): Contract.Output["rules"][string] {
  if (!isAbsolute(source.path)) return source
  if (source.package !== undefined) throw new Error("Пакетная ссылка не содержит абсолютного пути")
  if (directory !== undefined) {
    const base = resolve(fileURLToPath(new URL("../../../", import.meta.url)), directory)
    const path = relative(base, source.path).split(sep).join("/")
    if (path !== ".." && !path.startsWith("../")) return {path}
  }
  for (let owner = dirname(source.path);; owner = dirname(owner)) {
    const manifest = resolve(owner, "package.json")
    if (existsSync(manifest)) {
      const metadata = JSON.parse(readFileSync(manifest, "utf8"))
      if (typeof metadata.name === "string") return {package: metadata.name, path: relative(owner, source.path).split(sep).join("/")}
    }
    if (dirname(owner) === owner) break
  }
  throw new Error("У источника не определён пакет-владелец")
}
