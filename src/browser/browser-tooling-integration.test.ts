import {describe, expect, test} from "bun:test"
import {existsSync} from "node:fs"
import {join} from "node:path"

const root = join(import.meta.dir, "../..")

describe("external Storybook agent tooling", () => {
  test("keeps Chrome mechanics in the shared browser controller", async () => {
    expect(existsSync(join(root, "scripts/storybook-browser.ts"))).toBeFalse()
    const chrome = await Bun.file(join(root, "src/external/browser-control/chrome-client.ts")).text()
    const controller = await Bun.file(join(root, "src/external/browser-control/controller.ts")).text()
    expect(chrome).toContain('connection.command("Target.createTarget"')
    expect(chrome).toContain("background: true")
    expect(chrome).toContain("StorybookCdpConnection")
    expect(chrome).toContain("BRIDGE_GLOBAL")
    expect(chrome).not.toContain("@meta/chrome")
    expect(chrome).not.toContain("7880")
    expect(chrome).not.toContain("Target.activateTarget")
    expect(chrome).not.toContain("Page.bringToFront")
    expect(chrome).not.toContain("Emulation.setFocusEmulationEnabled")
    expect(controller).toContain("StorybookViewRegistry")
    expect(controller).toContain("StorybookBrowserState")
    expect(controller).toContain("withStorybookBrowserLock")
    expect(controller).not.toContain("windowId")
    expect(controller).not.toContain("tabIndex")
    expect(controller).not.toContain("outputPath")
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
