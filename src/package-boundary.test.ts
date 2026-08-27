import {describe, expect, test} from "bun:test"
import {join} from "node:path"

const packageRoot = join(import.meta.dir, "..")

describe("@zavx0z/storybook package boundary", () => {
  test("publishes only the accepted exact subpaths", async () => {
    const manifest = await Bun.file(join(packageRoot, "package.json")).json() as {
      exports: Record<string, string>
      bin: Record<string, string>
      peerDependencies: Record<string, string>
    }
    expect(manifest.exports).toEqual({
      "./route-tree": "./src/route-tree.ts",
      "./stories": "./src/dom/stories.ts",
      "./catalog": "./src/dom/catalog.ts",
      "./workbench": "./src/dom/workbench.ts",
      "./references": "./src/references.ts",
      "./app": "./src/app.ts",
      "./server": "./src/server.ts",
      "./build": "./src/build.ts",
      "./environment": "./src/environment.ts",
      "./launcher": "./src/launcher.ts",
      "./scaffold": "./src/scaffold.ts",
    })
    expect(manifest.exports).not.toHaveProperty(".")
    expect(manifest.bin).toEqual({
      storybook: "./scripts/storybook.ts",
      "create-storybook": "./scripts/create-storybook.ts",
    })
    expect(manifest.peerDependencies).toEqual({
      "@zavx0z/dom": "^0.1.0",
    })
  })

  test("contains no compatibility or repository-domain surface", async () => {
    const glob = new Bun.Glob("**/*.ts")
    const sources: string[] = []
    for await (const path of glob.scan({cwd: import.meta.dir, onlyFiles: true})) {
      if (path.endsWith(".test.ts") || path.endsWith(".d.ts")) continue
      sources.push(await Bun.file(join(import.meta.dir, path)).text())
    }
    const source = sources.join("\n")
    for (const forbidden of [
      "@layout/core",
      "@ui/components",
      "@ui/elements",
      "@ui/storybook",
      "startStorybookServer",
      "deepRoutes",
      "NodeEditor",
      "NodeCanvas",
      "Socket",
      "Parameter",
      "Hamiltonian",
      "Bulk",
    ]) expect(source, forbidden).not.toContain(forbidden)

    const manifest = await Bun.file(join(packageRoot, "package.json")).text()
    for (const forbidden of [
      '"./dom/',
      '"@layout/core"',
      '"@ui/components"',
      '"@ui/elements"',
      '"@zavx0z/highlighter"',
    ]) expect(manifest, forbidden).not.toContain(forbidden)

    for (const legacyPath of [
      "src/stories.ts",
      "src/workbench.ts",
      "src/workbench/layout.ts",
      "src/workbench/surfaces.ts",
      "src/workbench/theme.ts",
      "src/shell-theme.ts",
    ]) expect(await Bun.file(join(packageRoot, legacyPath)).exists(), legacyPath).toBeFalse()
  })
})
