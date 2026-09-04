import {plugin} from "bun"
import {readFileSync} from "node:fs"
import {join, resolve} from "node:path"
import {createTemplateJsxBunPlugin} from "@zavx0z/template/bun"
import {
  createStorybookOwnerResolver,
  createStorybookOwnerSourcePath,
  resolveStorybookCompilerSourceRoots,
} from "../../external/compiler.ts"

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

const ownerResolver = createStorybookOwnerResolver({
  projectRoot: storybookRoot,
  packageRoot: storybookRoot,
})
const ownerSourcePath = createStorybookOwnerSourcePath({
  projectRoot: storybookRoot,
  packageRoot: storybookRoot,
})
const templateCompiler = createTemplateJsxBunPlugin({
  persistent: true,
  sourceRoots,
  styleSourceRootIds,
})

plugin({
  name: "external-storybook-runtime-owners",
  setup(builder) {
    ownerResolver.setup(builder)
    templateCompiler.setup({
      ...builder,
      onLoad(options, callback) {
        return builder.onLoad(options, arguments_ => callback({
          ...arguments_,
          path: ownerSourcePath(arguments_.path),
        }))
      },
    })
  },
})

let loading: Promise<typeof import("../controller.ts")> | null = null

export function loadCompiledWorkbench(): Promise<typeof import("../controller.ts")> {
  loading ??= import("../controller.ts")
  return loading
}
