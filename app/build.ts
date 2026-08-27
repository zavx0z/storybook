import {dirname, join, resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {
  buildStaticStorybook,
  readGitIdentity,
  type StorybookDependencyIdentity,
} from "@zavx0z/storybook/build"
import {normalizeStorybookBasePath} from "@zavx0z/storybook/environment"
import {createStorybookDocumentationApp} from "./manifest.ts"
import {storybookDocumentationStaticFiles} from "./static-files.ts"

const repositoryRoot = resolve(import.meta.dir, "..")
const publicBasePath = normalizeStorybookBasePath(Bun.env.STORYBOOK_BASE_PATH ?? "/storybook")
const app = createStorybookDocumentationApp({publicBasePath})
const manifest = await buildStaticStorybook({
  app,
  outputRoot: join(repositoryRoot, "dist"),
  source: await readGitIdentity(repositoryRoot),
  dependencies: await dependencyIdentities(),
  staticFiles: storybookDocumentationStaticFiles(),
})

console.log(`[storybook documentation] built ${manifest.pages.length} pages for ${publicBasePath}/`)

async function dependencyIdentities(): Promise<readonly StorybookDependencyIdentity[]> {
  const inputs = [
    ["@engine/core", import.meta.resolve("@engine/core/default-font")],
    ["@zavx0z/dom", import.meta.resolve("@zavx0z/dom")],
    ["@zavx0z/renderer", import.meta.resolve("@zavx0z/renderer")],
    ["@zavx0z/renderer-browser", import.meta.resolve("@zavx0z/renderer-browser")],
    ["@zavx0z/renderer-webgpu", import.meta.resolve("@zavx0z/renderer-webgpu")],
  ] as const
  return Object.freeze(await Promise.all(inputs.map(async ([name, entry]) => ({
    name,
    ...await readGitIdentity(dirname(fileURLToPath(entry))),
  }))))
}
