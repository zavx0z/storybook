import {describe, expect, test} from "bun:test"
import {existsSync} from "node:fs"
import {join} from "node:path"

const root = join(import.meta.dir, "../..")

describe("external Storybook agent tooling", () => {
  test("keeps Chrome mechanics in the private browser lifecycle package", async () => {
    expect(existsSync(join(root, "scripts/storybook-browser.ts"))).toBeFalse()
    const chrome = await Bun.file(join(root, "packages/browser-lifecycle/src/chrome-client.ts")).text()
    const lifecycle = await Bun.file(join(root, "packages/browser-lifecycle/src/service.ts")).text()
    const landing = await Bun.file(join(root, "src/external/browser/landing-entry.ts")).text()
    const manifest = await Bun.file(join(root, "packages/browser-lifecycle/package.json")).json()
    expect(chrome).toContain('connection.command("Target.createTarget"')
    expect(chrome).toContain("background: true")
    expect(chrome).toContain("StorybookCdpConnection")
    expect(chrome).toContain("BRIDGE_GLOBAL")
    expect(chrome).not.toContain("@meta/chrome")
    expect(chrome).not.toContain("7880")
    expect(chrome).not.toContain("Target.activateTarget")
    expect(chrome).not.toContain("Page.bringToFront")
    expect(chrome).not.toContain("Emulation.setFocusEmulationEnabled")
    expect(lifecycle).toContain("StorybookViewRegistry")
    expect(lifecycle).toContain("StorybookBrowserState")
    expect(lifecycle).toContain("withStorybookBrowserLock")
    expect(lifecycle).not.toContain("windowId")
    expect(lifecycle).not.toContain("tabIndex")
    expect(lifecycle).not.toContain("outputPath")
    expect(landing).not.toContain("globalThis.open")
    expect(landing).not.toContain("window.open")
    expect(manifest.name).toBe("@zavx0z/storybook-browser-lifecycle")
    expect(manifest.private).toBeTrue()
  })

  test("keeps CLI as a thin adapter to the same controller", async () => {
    const source = await Bun.file(join(root, "src/external/cli.ts")).text()
    expect(source).toContain('from "./controller.ts"')
    expect(source).toContain("createExternalStorybookController")
    expect(source).not.toContain("startExternalStorybookServer")
    expect(source).not.toContain("inspectExternalStorybookServer")
    expect(source).not.toContain("Bun.spawn")
    expect(source).not.toContain("storybook-browser.ts")
  })

  test("keeps the one Storybook skill MCP-only and non-executable", async () => {
    const skill = await Bun.file(join(root, ".agents/skills/storybook/SKILL.md")).text()
    expect(skill).toContain("Use only `storybook_*` MCP tools")
    expect(skill).toContain("storybook_search")
    expect(skill).toContain("storybook_capture")
    expect(skill).not.toContain("storybook.sh")
    expect(skill).not.toContain("targetId")
    expect(skill).not.toContain("ai-macos")
    expect(skill).not.toContain("@meta/chrome")
    expect(existsSync(join(root, ".agents/skills/storybook/scripts/storybook.sh"))).toBeFalse()
  })

  test("launcher exposes only the one human CLI entry", async () => {
    const source = await Bun.file(join(root, "scripts/storybook.ts")).text()
    expect(source).toContain("runExternalStorybookCli")
    expect(source).not.toContain("launchStorybookPackage")
    expect(source).not.toContain("openStartedBrowserTarget")
  })
})
