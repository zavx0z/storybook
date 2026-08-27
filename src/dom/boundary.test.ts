import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {Node as PublicNode} from "@zavx0z/dom"
import {createDocument} from "@zavx0z/dom"
import {defineStorybookDomStory} from "@zavx0z/storybook/stories"
import {defineStorybookDomCatalog} from "@zavx0z/storybook/catalog"
import {createStorybookDomWorkbench} from "@zavx0z/storybook/workbench"

const root = join(import.meta.dir, "..", "..")

describe("DOM Storybook package boundary", () => {
  test("resolves exact natural exports against one peer DOM realm", () => {
    const document = createDocument()
    const workbench = createStorybookDomWorkbench({document})
    const story = defineStorybookDomStory({
      defaultArgs: {},
      render: (realm) => realm.createElement("div"),
      source: () => ({html: "<div></div>", css: "div {}", typescript: "create()"}),
    })

    expect(workbench.element).toBeInstanceOf(PublicNode)
    expect(story.render(document, {}, null)).toBeInstanceOf(PublicNode)
    expect(defineStorybookDomCatalog).toBeFunction()
  })

  test("declares DOM as a peer and local development dependency", async () => {
    const manifest = await Bun.file(join(root, "package.json")).json() as {
      exports: Record<string, string>
      peerDependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(manifest.exports["./stories"]).toBe("./src/dom/stories.ts")
    expect(manifest.exports["./catalog"]).toBe("./src/dom/catalog.ts")
    expect(manifest.exports["./workbench"]).toBe("./src/dom/workbench.ts")
    expect(Object.keys(manifest.exports).some((subpath) => subpath.startsWith("./dom/"))).toBeFalse()
    expect(manifest.peerDependencies["@zavx0z/dom"]).toBe("^0.1.0")
    expect(manifest.devDependencies["@zavx0z/dom"]).toBe("link:@zavx0z/dom")
  })

  test("keeps new modules free of Engine, Layout, Elements and numeric surface APIs", async () => {
    const sources = await Promise.all([
      Bun.file(join(import.meta.dir, "stories.ts")).text(),
      Bun.file(join(import.meta.dir, "catalog.ts")).text(),
      Bun.file(join(import.meta.dir, "workbench.ts")).text(),
    ])
    const imports = sources.join("\n").match(/from\s+["'][^"']+["']/gu) ?? []
    expect(imports).toEqual(expect.arrayContaining([
      'from "@zavx0z/dom"',
    ]))
    for (const source of sources) {
      expect(source).not.toMatch(/from\s+["']@engine\//u)
      expect(source).not.toMatch(/from\s+["']@layout\//u)
      expect(source).not.toMatch(/from\s+["']@ui\/(?:elements|components)/u)
      expect(source).not.toMatch(/\bUiSurface\b|\bstatusBar\s*\(\s*surface\b/u)
    }
  })
})
