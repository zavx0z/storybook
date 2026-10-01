import {expect, test} from "bun:test"
import {resolve} from "node:path"
import discoverStorybookPackages from "@repo/discovery"
import ExternalStorybookRegistry from "@app-server/catalog"
import WebBuild from "@app-web/build"

const storybookRoot = resolve(import.meta.dir, "../../..")
const fixtureRoot = resolve(storybookRoot, "repo/discovery/fixtures/valid")

  test("copies one Workbench theme for each package revision", async () => {
    const registry = new ExternalStorybookRegistry(discoverStorybookPackages, () => WebBuild.readTheme(storybookRoot))
    await registry.attachMany([storybookRoot, fixtureRoot])
    const descriptor = registry.packageDescriptors().find(({packageId}) => packageId === "@fixture/components")!
    expect(descriptor.graphSnapshot.workbenchAuthorStyleSheets.map(({specifier, url}) => ({specifier, url}))).toEqual([{
      specifier: "@zavx0z/ui/theme/theme.css",
      url: "workbench-author-style-sheets/0.css",
    }])
    const resource = descriptor.resourceFiles?.find(({targetPath}) => targetPath === "workbench-author-style-sheets/0.css")
    expect(resource?.contentDigest).toBe(descriptor.graphSnapshot.workbenchAuthorStyleSheets[0]!.contentDigest)
    expect(resource?.sourcePath).toEndWith("/ui/theme/theme.css")
    expect(descriptor.resourceFiles).toContain(resource!)
  }, 20_000)
