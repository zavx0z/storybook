import {readFileSync, realpathSync} from "node:fs"
import {join} from "node:path"
import type {StorybookPackageOwner} from "../contract/owner"

/** Подтверждает exact workspace-владельца двух обязательных native automatic JSX exports. */
export function isOwnedJsxProtocol(
  packageRoot: string,
  specifier: string,
  owner: StorybookPackageOwner | null,
): boolean {
  const protocols: Readonly<Record<string, Readonly<{directory: string; name: string}>>> = {
    "@immersive/jsx/jsx-runtime": {directory: "runtime", name: "@immersive-jsx/runtime"},
    "@immersive/jsx/jsx-dev-runtime": {directory: "development", name: "@immersive-jsx/development"},
  }
  const expected = protocols[specifier]
  if (expected === undefined || owner?.name !== expected.name) return false
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>
  if (manifest.name !== "@immersive/jsx" ||
    (manifest.exports as Record<string, unknown> | undefined)?.[specifier.slice("@immersive/jsx".length).replace(/^\//u, "./")] !== `./${expected.directory}/index.ts`) return false
  const dependencies = manifest.dependencies
  if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies)) return false
  const dependency = (dependencies as Record<string, unknown>)[expected.name]
  if (typeof dependency !== "string" || dependency.length === 0) return false
  return realpathSync(join(packageRoot, expected.directory)) === owner.root
}
