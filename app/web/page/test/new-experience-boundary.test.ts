import {expect, test} from "bun:test"
import {resolve} from "node:path"

const sourceRoot = resolve(import.meta.dir, "../..")
const repositoryRoot = resolve(import.meta.dir, "../../../..")

test("[STORYBOOK-EXPERIENCE-001] shell использует только новый Browser Root", async () => {
  const shell = await Bun.file(resolve(sourceRoot, "page/shell/index.ts")).text()
  const manifest = await Bun.file(resolve(repositoryRoot, "package.json")).json() as {
    devDependencies: Readonly<Record<string, string>>
  }

  expect(shell).toContain('from "@zavx0z/immersive-browser/integration"')
  expect(shell).toContain("createBrowserRoot")
  expect(shell).toContain("application.render(")
  expect(shell).toContain("root.document")
  expect(shell).toContain("root.getProjection(")
  expect(shell).not.toContain("createDocumentSpaceRuntime")
  expect(shell).not.toContain("DocumentSpaceRuntime")
  expect(shell).not.toContain("DocumentOverlayRuntime")
  expect(shell).not.toContain("workbenchOverlay")

  for (const required of [
    "@zavx0z/immersive-browser",
    "@zavx0z/immersive-component",
    "@zavx0z/immersive-dom",
    "@zavx0z/immersive-engine",
    "@zavx0z/immersive-renderer-html",
    "@zavx0z/immersive-space",
    "@zavx0z/immersive-template",
    "@zavx0z/immersive-ui-component",
    "@zavx0z/immersive-webgpu",
  ]) expect(manifest.devDependencies[required], required).toBeDefined()

  for (const forbidden of [
    "@engine/core",
    "@ui/components",
    "@zavx0z/react",
    "@zavx0z/renderer-browser",
    "@zavx0z/renderer-webgpu",
  ]) expect(manifest.devDependencies[forbidden], forbidden).toBeUndefined()
})

test("[STORYBOOK-EXPERIENCE-002] Workbench принадлежит Display, Minimap — HUD, контент — Display или Space", async () => {
  const shell = await Bun.file(resolve(sourceRoot, "page/shell/index.ts")).text()
  const presentation = await Bun.file(resolve(sourceRoot, "workbench/src/presentation.ts")).text()
  const spacePreview = await Bun.file(resolve(sourceRoot, "page/shell/contract/preview.ts")).text()

  expect(shell).toContain("root.space")
  expect(shell).toContain("root.viewPoint")
  expect(shell).toContain("DisplayElement")
  expect(shell).toContain("HUDElement")
  const app = await Bun.file(resolve(sourceRoot, "page/shell/src/application.tsx")).text()
  expect(app).toContain("<hud")
  expect(app).toContain("<Workbench")
  expect(app).not.toContain("createWorkbench(")
  expect(app).toContain("<WorkbenchMinimap")
  expect(app).toContain("initialState={props.minimapState}")
  expect(app).not.toContain("key=")
  expect(presentation).toContain('projection === "display"')
  expect(presentation).toContain('projection === "hud"')
  expect(presentation).toContain('projection !== "space"')
  expect(presentation).not.toContain('projection === "world"')
  expect(spacePreview).toContain("StorybookSpacePreviewRegistration")
  expect(spacePreview).toContain("node: SemanticNode")
  expect(spacePreview).not.toContain("@engine/core")
})
