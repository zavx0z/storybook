import {expect, test} from "bun:test"
import {resolve, join} from "node:path"
import {createHash} from "node:crypto"
import {mkdtempSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import discoverStorybookPackages from "@zavx0z/storybook-package-metadata-collect"
import ExternalStorybookRegistry from "@zavx0z/storybook-app-server-catalog"
import WebBuild from "@zavx0z/storybook-app-web-build"

const storybookRoot = resolve(import.meta.dir, "../../..")
const fixtureRoot = resolve(storybookRoot, "package/metadata/collect/fixtures/valid")

  test("copies one Workbench theme for each package revision", async () => {
    const registry = new ExternalStorybookRegistry(discoverStorybookPackages, () => WebBuild.readTheme(storybookRoot))
    await registry.attachMany([fixtureRoot])
    const descriptor = registry.packageDescriptors().find(({packageId}) => packageId === "@fixture/components")!
    expect(descriptor.graphSnapshot.workbenchAuthorStyleSheets.map(({specifier, url}) => ({specifier, url}))).toEqual([{
      specifier: "@zavx0z/immersive-ui-component/theme/theme.css",
      url: "workbench-author-style-sheets/0.css",
    }])
    const resource = descriptor.resourceFiles?.find(({targetPath}) => targetPath === "workbench-author-style-sheets/0.css")
    expect(resource?.contentDigest).toBe(descriptor.graphSnapshot.workbenchAuthorStyleSheets[0]!.contentDigest)
    expect(resource?.sourcePath).toBe(Bun.resolveSync("@zavx0z/immersive-ui-component/theme/theme.css", storybookRoot))
    expect(descriptor.resourceFiles).toContain(resource!)
  }, 20_000)


test("CSS descriptor сохраняет свой текст и digest после последующего изменения файла", async () => {
  const ownerRoot = mkdtempSync(join(tmpdir(), "storybook-style-snapshot-"))
  const path = join(ownerRoot, "theme.css")
  const original = ".sample { color: red; }"
  const hash = (text: string) => createHash("sha256").update(text).digest("hex")
  try {
    writeFileSync(path, original)
    const registry = new ExternalStorybookRegistry(discoverStorybookPackages, () => [{
      specifier: "@fixture/theme/theme.css", path, ownerRoot,
      ownerPackageJsonPath: join(ownerRoot, "package.json"), contentDigest: hash(original),
    }])
    await registry.attachMany([fixtureRoot])
    const descriptor = registry.packageDescriptors().find(item => item.packageId === "@fixture/components")!
    const resource = descriptor.resourceFiles!.find(item => item.targetPath === "workbench-author-style-sheets/0.css")!
    writeFileSync(path, ".sample { color: blue; }")
    expect(resource.derivedContent).toBe(original)
    expect(hash(resource.derivedContent!)).toBe(descriptor.graphSnapshot.workbenchAuthorStyleSheets[0]!.contentDigest)
    expect(resource.contentDigest).toBe(hash(original))
  } finally { rmSync(ownerRoot, {recursive: true, force: true}) }
}, 20_000)
