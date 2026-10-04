import {existsSync, mkdirSync, realpathSync, symlinkSync} from "node:fs"
import {dirname, join} from "node:path"
import {readStorybookPackageRoot} from "./owner-identity.ts"

/** Связывает generated TSX root с exact native JSX package без tsconfig paths или копий runtime. */
export function ensureGeneratedJsxProtocol(sourceRoot: string, toolRoot: string): void {
  const owner = readStorybookPackageRoot(join(toolRoot, "node_modules", "@zavx0z", "jsx"))
  if (owner.name !== "@immersive/jsx") throw new Error(`Generated JSX protocol has a foreign owner: ${owner.name}`)
  const dependency = join(sourceRoot, "node_modules", "@zavx0z", "jsx")
  if (existsSync(dependency)) {
    if (realpathSync(dependency) !== owner.root) throw new Error(`Generated JSX protocol owner differs: ${dependency}`)
    return
  }
  mkdirSync(dirname(dependency), {recursive: true})
  symlinkSync(owner.root, dependency, "dir")
}
