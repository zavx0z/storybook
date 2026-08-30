import {plugin} from "bun"
import {readFileSync} from "node:fs"
import {join, resolve} from "node:path"
import {createTemplateJsxBunPlugin} from "@zavx0z/template/bun"
import {resolveStorybookCompilerSourceRoots} from "../../external/compiler.ts"

const storybookRoot = resolve(import.meta.dir, "../../..")
const sourceRoots = resolveStorybookCompilerSourceRoots({
  projectRoot: storybookRoot,
  packageRoot: storybookRoot,
})
const styleSourceRootIds = Object.freeze(sourceRoots.map((root) => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {name?: unknown}
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error(`Storybook test compiler root has no package identity: ${root}`)
  }
  return manifest.name
}))

plugin(createTemplateJsxBunPlugin({
  persistent: true,
  sourceRoots,
  styleSourceRootIds,
}))

let loading: Promise<typeof import("../controller.ts")> | null = null

export function loadCompiledWorkbench(): Promise<typeof import("../controller.ts")> {
  loading ??= import("../controller.ts")
  return loading
}
