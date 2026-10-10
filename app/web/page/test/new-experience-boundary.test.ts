import {expect, test} from "bun:test"
import {resolve} from "node:path"

const sourceRoot = resolve(import.meta.dir, "../..")
const repositoryRoot = resolve(import.meta.dir, "../../../..")

test("[STORYBOOK-EXPERIENCE-001] shell использует только новый Browser Root", async () => {
  const shell = await Bun.file(resolve(sourceRoot, "page/shell/index.ts")).text()
  const manifest = await Bun.file(resolve(repositoryRoot, "package.json")).json() as {
    devDependencies: Readonly<Record<string, string>>
  }

  expect(shell).toContain('from "@zavx0z/immersive/XReact/browser/integration"')
  expect(shell).toContain("createBrowserRoot")
  expect(shell).toContain("application.render(")
  expect(shell).toContain("root.document")
  expect(shell).toContain("root.getProjection(")
  expect(shell).not.toContain("createDocumentSpaceRuntime")
  expect(shell).not.toContain("DocumentSpaceRuntime")
  expect(shell).not.toContain("DocumentOverlayRuntime")
  expect(shell).not.toContain("workbenchOverlay")

  expect(Object.keys(manifest.devDependencies).filter(name =>
    name === "@zavx0z/immersive" || name.startsWith("@zavx0z/immersive-") || name.startsWith("@zavx0z/immersive/")))
    .toEqual(["@zavx0z/immersive"])
  for (const required of [
    "@zavx0z/immersive/XReact/browser",
    "@zavx0z/immersive/XReact",
    "@zavx0z/immersive",
    "@zavx0z/immersive/engine",
    "@zavx0z/immersive/renderer/html",
    "@zavx0z/immersive/space",
    "@zavx0z/immersive/template",
    "@zavx0z/immersive/ui",
    "@zavx0z/immersive/webgpu",
  ]) expect(Bun.resolveSync(required, repositoryRoot), required).toMatch(/\/dist\/.+\.js$/u)

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
  const presentation = await Bun.file(resolve(sourceRoot, "page/shell/workbench/src/presentation.ts")).text()
  const spacePreview = await Bun.file(resolve(sourceRoot, "page/shell/contract/preview.ts")).text()

  expect(shell).toContain("root.space")
  expect(shell).toContain("root.viewPoint")
  expect(shell).toContain("DisplayElement")
  expect(shell).toContain("HUDElement")
  const app = await Bun.file(resolve(sourceRoot, "page/shell/src/application.tsx")).text()
  const hud = await Bun.file(resolve(sourceRoot, "page/shell/src/hud.tsx")).text()
  expect(app).toContain('import {StorybookHud} from "./hud"')
  expect(app).toContain("<StorybookHud")
  expect(hud).toContain("<hud")
  expect(app).toContain("<Workbench")
  expect(app).not.toContain("createWorkbench(")
  expect(hud).toContain("<WorkbenchMinimap")
  expect(hud).toContain("initialState={app.minimapState}")
  expect(`${app}\n${hud}`.match(/<hud(?:\s|>)/g), "HUD-композиция использует один HUD того же Space").toHaveLength(1)
  expect(app.match(/<space(?:\s|>)/g), "App объявляет один Space").toHaveLength(1)
  expect(app.match(/<viewpoint[\s\S]*?\/>/)?.[0], "ViewPoint сохраняет identity при изменении карточек").not.toContain("key=")
  expect(presentation).toContain('projection === "display"')
  expect(presentation).toContain('projection === "hud"')
  expect(presentation).toContain('projection !== "space"')
  expect(presentation).not.toContain('projection === "world"')
  expect(spacePreview).toContain("StorybookSpacePreviewRegistration")
  expect(spacePreview).toContain("node: SemanticNode")
  expect(spacePreview).not.toContain("@engine/core")
})
