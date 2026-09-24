/** Общая тема принадлежит оболочке Storybook, а не конфигурациям потребителей. */
import {createHash} from "node:crypto"
import {lstatSync, readFileSync, realpathSync} from "node:fs"
import {dirname, join, resolve} from "node:path"
import type {StorybookAuthorStyleSheet} from "../catalog/catalog.t"

/** Читает единственный публичный CSS export темы UI без проектных деклараций. */
export function readWorkbenchStyleSheets(toolRoot = resolve(import.meta.dir, "..")): readonly StorybookAuthorStyleSheet[] {
  const specifier = "@zavx0z/ui/themes/theme.css"
  const path = realpathSync(Bun.resolveSync(specifier, toolRoot))
  let ownerRoot = dirname(path)
  while (true) {
    const metadataPath = join(ownerRoot, "package.json")
    const info = lstatSync(metadataPath, {throwIfNoEntry: false})
    if (info?.isFile() && !info.isSymbolicLink()) {
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"))
      if (metadata.name === "@zavx0z/ui") {
        const target = metadata.exports?.["./themes/theme.css"]
        if (typeof target !== "string" || !target.startsWith("./") || realpathSync(resolve(ownerRoot, target)) !== path) {
          throw new Error(`Theme must be an exact public CSS export: ${specifier}`)
        }
        return Object.freeze([Object.freeze({specifier, path, ownerRoot, ownerPackageJsonPath: metadataPath,
          contentDigest: createHash("sha256").update(readFileSync(path)).digest("hex"),
        })])
      }
    }
    const parent = dirname(ownerRoot)
    if (parent === ownerRoot) throw new Error(`Theme owner is missing: ${specifier}`)
    ownerRoot = parent
  }
}
