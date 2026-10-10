import {dirname, isAbsolute, relative, resolve, sep} from "node:path"
import {realpath} from "node:fs/promises"
import Compiler from "@zavx0z/storybook-tech-build-compiler"
import readPackageIndex from "@zavx0z/storybook-package-index"

/** Разрешает authoring identity публичного адреса; runtime imports по-прежнему используют готовый JS. */
export async function sourceModule(specifier: string, parent: string, conditions: readonly string[] = []): Promise<string> {
  const ready = await realpath(Bun.resolveSync(specifier, dirname(parent)))
  const owner = Compiler.readStorybookPackageOwner(ready)
  if (owner === null || !(specifier === owner.name || specifier.startsWith(`${owner.name}/`))) return ready
  const metadata = await Bun.file(resolve(owner.root, "package.json")).json()
  const exports = metadata.exports
  const subpath = specifier === owner.name ? "." : `.${specifier.slice(owner.name.length)}`
  const declaration = exports && typeof exports === "object" && !Array.isArray(exports)
    && Object.keys(exports).some(key => key.startsWith(".")) ? exports[subpath] : subpath === "." ? exports : undefined
  const selectedConditions = [...conditions, "bun", "node", "import"]
  const declaredSource = (value: unknown): string | null => {
    if (Array.isArray(value)) {
      for (const child of value) {
        const source = declaredSource(child)
        if (source !== null) return source
      }
      return null
    }
    if (!value || typeof value !== "object") return null
    if (Object.hasOwn(value, "source")) return Compiler.conditionalExportTarget(Reflect.get(value, "source"), selectedConditions)
    for (const [condition, child] of Object.entries(value)) {
      if (condition === "default" || selectedConditions.includes(condition)) {
        const source = declaredSource(child)
        if (source !== null) return source
      }
    }
    return null
  }
  const target = declaredSource(declaration)
  if (target === null || !target.startsWith("./")) return ready
  const path = resolve(owner.root, target)
  const tail = relative(owner.root, path)
  if (tail === ".." || tail.startsWith(`..${sep}`) || isAbsolute(tail)) throw new Error(`Source export escaped its owner: ${specifier}`)
  const authored = await realpath(path)
  if (authored === ready) return ready
  const index = await readPackageIndex({path: owner.root, exports: {[subpath]: target}})
  const entry = index.entries[0]
  if (!entry?.entrypoint || !["owned", "forwarded"].includes(entry.status)) throw new Error(`Source export is not public at its owner: ${specifier}`)
  const actual = Compiler.readStorybookPackageOwner(authored)
  const expected = entry.owner?.path ?? owner.root
  if (actual === null || !Compiler.sameStorybookPackageOwner(actual.root, expected)) throw new Error(`Source export changed its owner: ${specifier}`)
  return authored
}
