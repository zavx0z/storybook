import Compiler from "@build/compiler"
import {plugin} from "bun"
import {readFileSync} from "node:fs"
import {join, resolve} from "node:path"
import createJsxBunPlugin from "@jsx-compiler/bun"
const {createStorybookOwnerResolver, createStorybookOwnerSourcePath, resolveStorybookCompilerSourceRoots} = Compiler
const storybookRoot = resolve(import.meta.dir, "../../../..")
const sourceRoots = resolveStorybookCompilerSourceRoots({
  repo: storybookRoot,
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
  repo: storybookRoot,
  packageRoot: storybookRoot,
})
const ownerSourcePath = createStorybookOwnerSourcePath({
  repo: storybookRoot,
  packageRoot: storybookRoot,
})
const templateCompiler = createJsxBunPlugin({
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
        // Сценарии сохраняют JSX transport и обработку инспектором до production-компилятора.
        return builder.onLoad({...options, filter: /^(?!.*\.(?:spec|test)\.tsx$).*\.(?:[cm]?jsx|[cm]?tsx)$/}, arguments_ => callback({
          ...arguments_,
          path: ownerSourcePath(arguments_.path),
        }))
      },
    })
  },
})
