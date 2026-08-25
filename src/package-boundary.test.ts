import {describe, expect, test} from "bun:test"
import {join} from "node:path"

const packageRoot = join(import.meta.dir, "..")

describe("@zavx0z/storybook package boundary", () => {
  test("publishes only the accepted exact subpaths", async () => {
    const manifest = await Bun.file(join(packageRoot, "package.json")).json() as {
      exports: Record<string, string>
      peerDependencies: Record<string, string>
    }
    expect(manifest.exports).toEqual({
      "./route-tree": "./src/route-tree.ts",
      "./stories": "./src/stories.ts",
      "./workbench": "./src/workbench.ts",
      "./references": "./src/references.ts",
      "./app": "./src/app.ts",
      "./server": "./src/server.ts",
      "./build": "./src/build.ts",
      "./environment": "./src/environment.ts",
    })
    expect(manifest.exports).not.toHaveProperty(".")
    expect(manifest.peerDependencies).toEqual({
      "@engine/core": "0.0.1",
      "@layout/core": "0.1.0",
      "@ui/components": "0.0.1",
      "@ui/elements": "0.0.1",
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
  })
})
