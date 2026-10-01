import AppWebBuildOwner from "@app-web/build"
import BuildEnvironmentOwner from "@build/environment"
import {createHash} from "node:crypto"
import {mkdirSync, readFileSync, realpathSync, writeFileSync} from "node:fs"
import {dirname, join} from "node:path"

/**
Публикует проверяемые байты оболочки для серверных тестов пакетного lifecycle.
Receipt проверяет серверную композицию и реальные байты файлов; он не подтверждает
browser/GPU rendering и не заменяет тесты общего compiler владельца Web Build.
*/
export function seedPublishedSharedAssets(artifactRoot: string): void {
  const root = join(artifactRoot, "shared")
  const toolRoot = realpathSync(join(import.meta.dir, "../../.."))
  const bytes = "export {}\n"
  const digest = (value: string) => createHash("sha256").update(value).digest("hex")
  const modules = BuildEnvironmentOwner.createModuleEntries(toolRoot, join(artifactRoot, "identity-entries"))
    .map(({specifier, sourcePath}) => ({specifier, sourcePath,
      url: `/__storybook/shared/kernel/${digest(specifier)}.js`}))
  const sources = BuildEnvironmentOwner.sourceFiles(modules)
  const theme = AppWebBuildOwner.readTheme(toolRoot)[0]!
  const stylePath = `styles/${theme.contentDigest}.css`
  const paths = ["entries/page.js", "entries/package.js", "entries/bootstrap.js",
    ...modules.map(module => module.url.slice("/__storybook/shared/".length))]
  for (const path of paths) {
    mkdirSync(dirname(join(root, path)), {recursive: true})
    writeFileSync(join(root, path), bytes)
  }
  mkdirSync(dirname(join(root, stylePath)), {recursive: true})
  writeFileSync(join(root, stylePath), readFileSync(theme.path))
  const identity = BuildEnvironmentOwner.identity("/__storybook/shared/entries/page.js", modules,
    digest("fixture host"), sources,
    "/__storybook/shared/entries/package.js")
  AppWebBuildOwner.saveReceipt({
    root,
    landingEntry: paths[0]!,
    fallbackEntry: paths[0]!,
    bootstrapEntry: paths[2]!,
    browserIdentity: identity,
    dependencyRealpaths: [...sources.map(source => source.path), theme.path],
    authorStyleSheets: [{specifier: theme.specifier, url: stylePath, contentDigest: theme.contentDigest}],
    artifactDigests: [...paths.map(path => ({path, digest: digest(bytes)})),
      {path: stylePath, digest: theme.contentDigest}],
  })
}
