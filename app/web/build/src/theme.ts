/** Общая тема принадлежит оболочке Storybook, а не конфигурациям потребителей. */
import {createHash} from "node:crypto"
import {lstatSync, readFileSync} from "node:fs"
import {dirname, join, resolve} from "node:path"
import type {WebAuthorStyleSheet} from "../contract/theme"
import Compiler from "@zavx0z/storybook-tech-build-compiler"

/** Читает единственный публичный CSS export темы UI без проектных деклараций. */
export function readWorkbenchStyleSheets(toolRoot: string): readonly WebAuthorStyleSheet[] {
  const specifier = "@zavx0z/immersive-ui-component/theme/theme.css"
  const path = Compiler.exactFile(Bun.resolveSync(specifier, toolRoot))
  let ownerRoot = dirname(path)
  while (true) {
    const metadataPath = join(ownerRoot, "package.json")
    const info = lstatSync(metadataPath, {throwIfNoEntry: false})
    if (info?.isFile() && !info.isSymbolicLink()) {
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"))
      if (metadata.name === "@zavx0z/immersive-ui-component") {
        const target = metadata.exports?.["./theme/theme.css"]
        if (typeof target !== "string" || !target.startsWith("./") || Compiler.exactFile(resolve(ownerRoot, target)) !== path) {
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
