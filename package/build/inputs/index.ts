/** Канонизирует входы компиляции и проверяет идентичность пакетов.

@packageDocumentation
*/
import PackageSessionOwner, {type PackageSession as PackageSessionContract} from "@package/session"
const storybookBuildError = PackageSessionOwner.buildError
const storybookDiagnostic = PackageSessionOwner.diagnostic
type StorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
import {existsSync, readFileSync, realpathSync} from "node:fs"
import {dirname, isAbsolute, join, resolve, sep} from "node:path"
import Compiler from "@build/compiler"
import type {PackageBuildInputs} from "./contract"

export type {PackageBuildInputs} from "./contract"

const {canonicalizeStorybookPackageFile, preferredStorybookPackageRoot, readStorybookPackageOwner, sameStorybookPackageOwner} = Compiler

function canonicalBuildInputs(
  inputs: Readonly<Record<string, unknown>>,
  projectRoot: string,
): readonly string[] {
  const paths = Object.keys(inputs).flatMap((path) => {
    if (path.startsWith("<") || path.startsWith("node:")) return []
    const candidates = isAbsolute(path)
      ? [path]
      : [resolve(projectRoot, path), resolve(process.cwd(), path)]
    const candidate = candidates.find(existsSync)
    return candidate === undefined ? [] : [stableBuildInputPath(candidate)]
  })
  return Object.freeze([...new Set(paths)].sort())
}

function stableBuildInputPath(path: string): string {
  const absolute = resolve(path)
  return join(realpathSync(dirname(absolute)), basename(absolute))
}

function validateConsumerBoundary(
  paths: readonly string[],
  descriptor: StorybookPackageBuildDescriptor,
  stagingDirectory: string,
): void {
  const roots = [descriptor.packageRoot, descriptor.projectRoot].map((path) => `${realpathSync(path)}${sep}`)
  const staging = `${resolve(stagingDirectory)}${sep}`
  for (const path of paths) {
    if (path.startsWith(staging) || !roots.some((root) => path.startsWith(root))) continue
    const source = readFileSync(path, "utf8")
    if (/from\s+["']@zavx0z\/storybook(?:\/[^"']*)?["']|import\s*\(\s*["']@zavx0z\/storybook/gu.test(source)) {
      throw storybookBuildError(storybookDiagnostic(
        "validate",
        "Consumer package imports external Storybook",
        path,
      ))
    }
  }
}

function canonicalizeStorybookPackageIdentities(paths: readonly string[]): readonly string[] {
  const identities = new Map<string, {paths: string[]; root: string}>()
  for (const path of paths) {
    const owner = readStorybookPackageOwner(path)
    if (owner === null) continue
    const current = identities.get(owner.name)
    if (current !== undefined && current.root !== owner.root) {
      if (!sameStorybookPackageOwner(current.root, owner.root)) {
        throw storybookBuildError(storybookDiagnostic(
          "link",
          `Package ${owner.name} resolved to two realpaths: ${current.root} via ${current.paths[0]} and ${owner.root} via ${path}`,
        ))
      }
      current.root = preferredStorybookPackageRoot(current.root, owner.root)
    }
    if (current === undefined) identities.set(owner.name, {paths: [path], root: owner.root})
    else current.paths.push(path)
  }
  const canonical = paths.map((path) => {
    const owner = readStorybookPackageOwner(path)
    if (owner === null) return path
    const identity = identities.get(owner.name)
    if (identity === undefined) return path
    try {
      return canonicalizeStorybookPackageFile(identity.root, path)
    } catch (error) {
      throw storybookBuildError(storybookDiagnostic(
        "link",
        error instanceof Error ? error.message : String(error),
        path,
      ))
    }
  })
  return Object.freeze([...new Set(canonical)].sort())
}

/** Сохраняет прежнюю поддержку разделителей обоих форматов пути. */
function basename(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return index < 0 ? path : path.slice(index + 1)
}


/** Один набор проверки физических входов пакетной сборки. */
const inputs: PackageBuildInputs.Output = Object.freeze({
  canonicalBuildInputs,
  stablePath: stableBuildInputPath,
  validateConsumerBoundary,
  canonicalizeIdentities: canonicalizeStorybookPackageIdentities,
})

export default inputs
