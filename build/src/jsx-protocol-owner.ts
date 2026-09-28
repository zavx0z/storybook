import {readFileSync, realpathSync} from "node:fs"
import {join} from "node:path"
import type {StorybookPackageOwner} from "../../src/shared/owner-identity.ts"

/** Подтверждает exact workspace-владельца двух обязательных native automatic JSX exports. */
export function isOwnedJsxProtocol(
  packageRoot: string,
  specifier: string,
  owner: StorybookPackageOwner | null,
): boolean {
  const protocols: Readonly<Record<string, Readonly<{directory: string; name: string}>>> = {
    "@zavx0z/jsx/jsx-runtime": {directory: "runtime", name: "@jsx/runtime"},
    "@zavx0z/jsx/jsx-dev-runtime": {directory: "development", name: "@jsx/development"},
  }
  const expected = protocols[specifier]
  if (expected === undefined || owner?.name !== expected.name) return false
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>
  if (manifest.name !== "@zavx0z/jsx" || !Array.isArray(manifest.workspaces) ||
    !manifest.workspaces.includes(expected.directory)) return false
  const dependencies = manifest.dependencies
  if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies)) return false
  const dependency = (dependencies as Record<string, unknown>)[expected.name]
  if (typeof dependency !== "string" || dependency.length === 0) return false
  return realpathSync(join(packageRoot, expected.directory)) === owner.root
}
