import {describe, expect, test} from "bun:test"
import {basename, dirname} from "node:path"
import {fileURLToPath} from "node:url"

const root = dirname(fileURLToPath(import.meta.url))

describe("self-documenting DOM Workbench application", () => {
  test("uses one semantic Document and one browser renderer runtime", async () => {
    const source = await Bun.file(`${root}/entry.ts`).text()
    for (const required of [
      'from "@zavx0z/dom"',
      'from "@zavx0z/renderer-browser"',
      'from "@zavx0z/storybook/workbench"',
      "createDocument()",
      "createStorybookDomWorkbench",
      "createDocumentCanvasRuntime",
      "runtime.render()",
      'dataset.storybookDocs = "ready"',
      "await waitForStorybookFrameBoundary()",
      "dataset.storybookDocsRoute",
      "dataset.storybookDocsHtml",
      "dataset.storybookDocsCss",
      "dataset.storybookDocsTypescript",
    ]) expect(source).toContain(required)
    for (const forbidden of [
      "@layout/core",
      "@ui/elements",
      "@ui/components",
      "UiRuntime",
      "UiSurface",
      "StorybookStatusBarSurface",
      "StorybookStoryPanelSurface",
    ]) expect(source).not.toContain(forbidden)
  })

  test("owns overview presentations instead of selecting a hidden detail", async () => {
    const source = await Bun.file(`${root}/entry.ts`).text()
    const branch = source.slice(
      source.indexOf('if (node.kind === "overview")'),
      source.indexOf("const nextIndex = storybookDocumentationIndex"),
    )
    expect(branch).toContain("applyOverview")
    expect(branch).toContain("story = null")
    expect(branch).not.toContain("STORYBOOK_DOCUMENTATION_CATALOG.load")
    expect(source).toContain("routeTree.children(node.path)")
    expect(source).toContain('workbench.update("scenarios.active", null)')
  })

  test("builds one entry and lazy DOM story chunks", async () => {
    const result = await Bun.build({
      entrypoints: [`${root}/entry.ts`],
      loader: {".wgsl": "text"},
      target: "browser",
      format: "esm",
      splitting: true,
      minify: false,
    })
    expect(result.success, result.logs.map(String).join("\n")).toBeTrue()
    const entry = result.outputs.find(({kind}) => kind === "entry-point")
    const chunks = result.outputs.filter(({kind}) => kind !== "entry-point")
    expect(entry).toBeDefined()
    expect(chunks.length).toBeGreaterThan(0)
    expect(basename(entry!.path)).toBe("entry.js")
    const entrySource = await entry!.text()
    const chunkSources = await Promise.all(chunks.map((chunk) => chunk.text()))
    expect(entrySource).toContain("storybookDocs")
    expect(entrySource).toContain("createDocumentCanvasRuntime")
    expect(entrySource).not.toContain("Проверить пример")
    expect(chunkSources.join("\n")).toContain("Проверить пример")
  }, 30_000)
})
