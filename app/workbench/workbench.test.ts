import {describe, expect, test} from "bun:test"
import {basename, dirname} from "node:path"
import {fileURLToPath} from "node:url"

const workbenchRoot = dirname(fileURLToPath(import.meta.url))
const productionFiles = [
  "entry.ts",
  "preview.ts",
  "stories.ts",
  "stories/button.ts",
  "stories/contract.ts",
] as const
const allowedSharedImports = new Set([
  "@zavx0z/storybook/route-tree",
  "@zavx0z/storybook/stories",
  "@zavx0z/storybook/workbench",
  "@zavx0z/storybook/environment",
])

describe("self-documenting Workbench boundary", () => {
  test("uses only exact public Storybook and production owner leaves", async () => {
    const seenSharedImports = new Set<string>()
    for (const path of productionFiles) {
      const source = await Bun.file(`${workbenchRoot}/${path}`).text()
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]!)
      for (const specifier of imports) {
        if (specifier.startsWith("@zavx0z/storybook")) {
          expect(allowedSharedImports.has(specifier), `${path}: ${specifier}`).toBeTrue()
          seenSharedImports.add(specifier)
        }
        expect(specifier, path).not.toBe("@layout/core")
        expect(specifier, path).not.toBe("@ui/components")
        expect(specifier, path).not.toBe("@ui/elements")
        expect(specifier, path).not.toContain("/src/")
      }
    }
    expect(seenSharedImports).toEqual(allowedSharedImports)
  })

  test("owns one runtime and publishes all five desktop Workbench regions", async () => {
    const source = await Bun.file(`${workbenchRoot}/entry.ts`).text()
    expect(source.match(/UiRuntime\.create/g)).toHaveLength(1)
    expect(source).toContain("compactBelow: null")
    for (const region of ["catalog", "section", "preview", "dock", "info"]) {
      expect(source).toContain(`frames(w, h).${region}`)
    }
    expect(source).toContain('dataset.storybookDocs = "ready"')
    expect(source).toContain("dataset.storybookDocsRoute = router.current.path")
    expect(source).toContain("dataset.storybookDocsSource = storyModule.source(args)")
    expect(source).toContain("dataset.storybookDocsArgs = JSON.stringify(args)")
  })

  test("builds one browser entry with a separately emitted lazy story graph", async () => {
    const result = await Bun.build({
      entrypoints: [`${workbenchRoot}/entry.ts`],
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
    expect(entrySource).toContain("UiRuntime.create")
    expect(entrySource).not.toContain("Проверить пример")
    expect(chunkSources.join("\n")).toContain("Проверить пример")
  }, 30_000)
})
