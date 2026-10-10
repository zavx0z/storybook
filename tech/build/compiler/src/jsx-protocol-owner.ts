import {readFileSync} from "node:fs"
import {isAbsolute, join, relative, resolve, sep} from "node:path"
import type {StorybookPackageOwner} from "../contract/owner"
import {sameStorybookPackageOwner} from "./owner-identity"
import {conditionalExportTarget} from "./export-target"
import {canonicalLexicalFile} from "./compiler"

/** Подтверждает публичный package owner двух обязательных native automatic JSX exports. */
export function isOwnedJsxProtocol(
  packageRoot: string,
  specifier: string,
  owner: StorybookPackageOwner | null,
): boolean {
  const packageName = "@zavx0z/immersive"
  if (specifier !== `${packageName}/XReact/jsx-runtime` &&
    specifier !== `${packageName}/XReact/jsx-dev-runtime`) return false
  if (owner?.name !== packageName) return false
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>
  if (manifest.name !== packageName || !sameStorybookPackageOwner(packageRoot, owner.root)) return false
  const exports = manifest.exports
  if (exports === null || typeof exports !== "object" || Array.isArray(exports)) return false
  const target = conditionalExportTarget((exports as Record<string, unknown>)[`.${specifier.slice(packageName.length)}`], ["types", "browser", "import"])
  if (target === null || !target.startsWith("./") || target.includes("*")) return false
  const file = canonicalLexicalFile(resolve(packageRoot, target), "native JSX protocol export")
  const tail = relative(owner.root, file)
  return tail !== "" && tail !== ".." && !tail.startsWith(`..${sep}`) && !isAbsolute(tail)
}
