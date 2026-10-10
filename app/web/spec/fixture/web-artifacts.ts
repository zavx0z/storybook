import Build from "@zavx0z/storybook-app-web-build"
import Environment from "@zavx0z/storybook-tech-build-environment"
import Scheduler from "@zavx0z/storybook-package-build-scheduler"
import type {StorybookAppWeb} from "@zavx0z/storybook-app-web"
import {createHash} from "node:crypto"
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"

type Assets = Awaited<ReturnType<typeof Build.buildAssets>>

/** Создаёт настоящие receipt-артефакты в отдельном временном root без компилятора. */
export function createWebArtifacts() {
  const root = mkdtempSync(join(tmpdir(), "app-web-scenario-"))
  const artifactRoot = join(root, "artifacts")
  const sharedRoot = join(artifactRoot, "shared")
  const sourcePath = join(root, "source.ts")
  const source = "export const example = 1\n"
  writeFileSync(sourcePath, source)
  const digest = (value: string) => createHash("sha256").update(value).digest("hex")
  const assets = (platform: string, host: string): Assets => {
    const paths = [
      `kernel/${platform}.js`,
      `entries/${platform}-${host}-page.js`,
      `entries/${platform}-${host}-bootstrap.js`,
    ]
    for (const path of paths) {
      mkdirSync(dirname(join(sharedRoot, path)), {recursive: true})
      writeFileSync(join(sharedRoot, path), "export {}\n")
    }
    return {
      root: sharedRoot,
      landingEntry: paths[1]!,
      fallbackEntry: paths[1]!,
      bootstrapEntry: paths[2]!,
      browserIdentity: Environment.identity(`/__storybook/shared/${paths[1]}`, [{
        specifier: "@zavx0z/immersive/XReact",
        sourcePath,
        url: `/__storybook/shared/${paths[0]}`,
      }], digest(host)),
      authorStyleSheets: [],
      artifactDigests: paths.map(path => ({path, digest: digest("export {}\n")})),
    }
  }
  const scheduler = new Scheduler({limit: 1})
  const input = (build: NonNullable<StorybookAppWeb.Input["build"]>, publish?: StorybookAppWeb.Input["publish"]): StorybookAppWeb.Input => ({
    toolRoot: root,
    artifactRoot,
    landingEntryPath: sourcePath,
    fallbackEntryPath: sourcePath,
    scheduler: () => scheduler,
    revisions: () => [],
    build,
    preparePlatform: async () => {
      const platform = assets("prepared-platform", "prepared-host")
      return {identity: platform.browserIdentity!, artifacts: platform.artifactDigests!.filter(artifact => artifact.path.startsWith("kernel/"))}
    },
    ...(publish === undefined ? {} : {publish}),
  })
  return {
    root,
    artifactRoot,
    sharedRoot,
    scheduler,
    assets,
    input,
    save: Build.saveReceipt,
    readPublished: () => Build.readPublishedReceipt({root: sharedRoot, toolRoot: root,
      landingEntryPath: sourcePath, fallbackEntryPath: sourcePath, stagingDirectory: root}),
    dispose: () => {
      scheduler.dispose()
      rmSync(root, {recursive: true, force: true})
    },
  }
}
