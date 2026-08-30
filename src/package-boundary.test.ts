import {describe, expect, test} from "bun:test"
import {existsSync} from "node:fs"
import {join, resolve} from "node:path"

const root = resolve(import.meta.dir, "..")

describe("external @zavx0z/storybook tool boundary", () => {
  test("publishes one CLI and no consumer code API", async () => {
    const manifest = await Bun.file(join(root, "package.json")).json() as Record<string, any>
    expect(manifest.private).toBeTrue()
    expect(manifest.exports).toBeUndefined()
    expect(manifest.bin).toEqual({storybook: "./scripts/storybook.ts"})
    expect(manifest.peerDependencies).toBeUndefined()
    expect(manifest.peerDependenciesMeta).toBeUndefined()
    expect(manifest.scripts.storybook).toBe("bun scripts/storybook.ts")
    expect(manifest.scripts.serve).toBe("bun scripts/storybook.ts serve .")
  })

  test("contains no package-local server, launcher, scaffold or npm template mode", () => {
    for (const path of [
      "app/server.ts",
      "app/build.ts",
      "scripts/create-storybook.ts",
      "src/app.ts",
      "src/build.ts",
      "src/server.ts",
      "src/launcher.ts",
      "src/scaffold.ts",
      "src/dom",
      "src/internal/package-runtime.ts",
      "templates/package/package.json.template",
    ]) expect(existsSync(join(root, path)), path).toBeFalse()
  })

  test("self documentation is an ordinary declaration without Storybook imports", async () => {
    const manifest = await Bun.file(join(root, ".storybook", "manifest.json")).json()
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      kind: "package",
      id: "@zavx0z/storybook",
      catalog: "./catalog.json",
    })
    for (const path of [
      ".storybook/runtime.ts",
      ".storybook/stories/contract-document.tsx",
      ".storybook/stories/contracts.tsx",
      ".storybook/stories/presentation.tsx",
      ".storybook/stories/story-types.ts",
    ]) expect(await Bun.file(join(root, path)).text(), path).not.toContain("@zavx0z/storybook")
  })

  test("shared browser shell uses exact internal owners rather than package exports", async () => {
    const sources = await Promise.all([
      "src/external/browser/shell.ts",
      "src/external/browser/landing-entry.ts",
      "src/external/browser/package-entry.ts",
    ].map((path) => Bun.file(join(root, path)).text()))
    const combined = sources.join("\n")
    expect(combined).toContain("createDocumentSpaceRuntime")
    expect(combined).toContain("runtime.addOverlay({")
    expect(combined).not.toContain("runtime.addWorld(")
    expect(combined).not.toContain("runtime.updateWorld(")
    expect(combined).not.toContain("runtime.removeWorld(")
    expect(combined).toContain("space: shell.runtime.space")
    expect(combined).toContain("runtime.viewPoint")
    expect(combined).toContain("workbenchOverlay")
    expect(combined).toContain("mountWorldPreview")
    expect(combined).not.toContain("createDocumentCanvasRuntime")
    expect(combined).not.toMatch(/from ["']@zavx0z\/storybook(?:\/[^"']*)?["']/u)
    expect(combined).not.toContain("UiSurface")
    expect(combined).not.toContain("@layout/core")
    expect(combined).not.toContain("@ui/elements")
    expect(combined).not.toContain("StorybookDom")
    expect(combined).not.toContain("STORYBOOK_DOM")
    expect(combined).toContain("workbench/contract.ts")
    expect(combined).toContain("workbench/controller.ts")
    const protocol = await Bun.file(join(root, "src/external/runtime-protocol.ts")).text()
    expect(protocol).toContain("mountWorldPreview")
    expect(protocol).not.toContain("engineRenderer")
    expect(protocol).not.toContain("DocumentSpaceRuntime")
  })
})
