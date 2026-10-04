/** Настраивает штатный JSX compiler на объявленные источники UI-зависимостей этого пакета. */
import Compiler from "@zavx0z/storybook-tech-build-compiler"
import createJsxBunPlugin from "@zavx0z/immersive-jsx-compiler-bun"
import {readFileSync} from "node:fs"
import {join, resolve} from "node:path"

const packageRoot = resolve(import.meta.dir, "../..")
const repo = resolve(packageRoot, "../..")
const sourceRoots = Compiler.resolveStorybookCompilerSourceRoots({repo, packageRoot})
const ownerResolver = Compiler.createStorybookOwnerResolver({repo, packageRoot})
const ownerSourcePath = Compiler.createStorybookOwnerSourcePath({repo, packageRoot})
const compiler = createJsxBunPlugin({
  persistent: true,
  sourceRoots,
  styleSourceRootIds: sourceRoots.map(root => JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name),
})
Bun.plugin({
  name: "chat-view-test-environment",
  setup(builder) {
    ownerResolver.setup(builder)
    compiler.setup({...builder, onLoad(options, callback) {
      return builder.onLoad({...options, filter: /^(?!.*\.(?:spec|test)\.tsx$).*\.(?:[cm]?jsx|[cm]?tsx)$/}, args =>
        callback({...args, path: ownerSourcePath(args.path)}))
    }})
  },
})
