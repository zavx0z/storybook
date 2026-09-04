import {expect, test} from "bun:test"
import {resolve} from "node:path"

const root = resolve(import.meta.dir, "../../..")

test("[STORYBOOK-EXPERIENCE-001] shell использует только новый Browser Experience", async () => {
  const shell = await Bun.file(resolve(import.meta.dir, "shell.ts")).text()
  const manifest = await Bun.file(resolve(root, "package.json")).json() as {
    devDependencies: Readonly<Record<string, string>>
  }

  expect(shell).toContain('from "@zavx0z/browser"')
  expect(shell).toContain("createExperience(")
  expect(shell).toContain("experience.document")
  expect(shell).toContain("experience.getProjection(")
  expect(shell).not.toContain("createDocumentSpaceRuntime")
  expect(shell).not.toContain("DocumentSpaceRuntime")
  expect(shell).not.toContain("DocumentOverlayRuntime")
  expect(shell).not.toContain("workbenchOverlay")

  for (const required of [
    "@zavx0z/browser",
    "@zavx0z/component",
    "@zavx0z/dom",
    "@zavx0z/engine",
    "@zavx0z/renderer",
    "@zavx0z/space",
    "@zavx0z/template",
    "@zavx0z/ui",
    "@zavx0z/webgpu",
  ]) expect(manifest.devDependencies[required], required).toBeDefined()

  for (const forbidden of [
    "@engine/core",
    "@ui/components",
    "@zavx0z/react",
    "@zavx0z/renderer-browser",
    "@zavx0z/renderer-webgpu",
  ]) expect(manifest.devDependencies[forbidden], forbidden).toBeUndefined()
})

test("[STORYBOOK-EXPERIENCE-002] Workbench принадлежит HUD, контент — Display или Space", async () => {
  const shell = await Bun.file(resolve(import.meta.dir, "shell.ts")).text()
  const presentation = await Bun.file(resolve(root, "src/workbench/presentation.ts")).text()
  const protocol = await Bun.file(resolve(root, "src/external/runtime-protocol.ts")).text()

  expect(shell).toContain("experience.space")
  expect(shell).toContain("experience.viewPoint")
  expect(shell).toContain("XRDisplayElement")
  expect(shell).toContain("XRHUDElement")
  expect(shell).toContain("parent: hud")
  expect(presentation).toContain('projection === "display"')
  expect(presentation).toContain('projection === "hud"')
  expect(presentation).toContain('projection !== "space"')
  expect(presentation).not.toContain('projection === "world"')
  expect(protocol).toContain('"storybook-runtime/4"')
  expect(protocol).toContain('projection: "space"')
  expect(protocol).not.toContain("@engine/core")
  expect(protocol).not.toContain('projection: "world"')
})
