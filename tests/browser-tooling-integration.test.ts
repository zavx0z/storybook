import {describe, expect, test} from "bun:test"
import {existsSync} from "node:fs"
import {join} from "node:path"

const root = join(import.meta.dir, "..")

describe("external Storybook agent tooling", () => {
  test("keeps Chrome mechanics in the private browser lifecycle package", async () => {
    expect(existsSync(join(root, "scripts/storybook-browser.ts"))).toBeFalse()
    const chrome = await Bun.file(join(root, "app/server/browser/src/chrome-client.ts")).text()
    const lifecycle = await Bun.file(join(root, "app/server/browser/index.ts")).text()
    const landing = await Bun.file(join(root, "app/web/page/home/index.ts")).text()
    const manifest = await Bun.file(join(root, "app/server/browser/package.json")).json()
    expect(chrome).toContain('connection.command("Target.createTarget"')
    expect(chrome).toContain("background: true")
    expect(chrome).toContain("StorybookCdpConnection")
    expect(chrome).toContain("BRIDGE_GLOBAL")
    expect(chrome).not.toContain("@meta/chrome")
    expect(chrome).not.toContain("7880")
    expect(chrome).not.toContain('connection.command("Target.activateTarget"')
    expect(chrome).not.toContain("Page.bringToFront")
    expect(chrome).not.toContain("Emulation.setFocusEmulationEnabled")
    expect(lifecycle).toContain("StorybookViewRegistry")
    expect(lifecycle).toContain("StorybookBrowserState")
    expect(lifecycle).toContain("withStorybookBrowserLock")
    expect(lifecycle).not.toContain("windowId")
    expect(lifecycle).not.toContain("tabIndex")
    expect(lifecycle).not.toContain("outputPath")
    expect(lifecycle).not.toContain("activateTarget")
    expect(landing).not.toContain("globalThis.open")
    expect(landing).not.toContain("window.open")
    expect(manifest.name).toBe("@zavx0z/storybook-app-server-browser")
    expect(manifest.private).toBeTrue()
  })

  test("запуск из scripts использует публичный API App", async () => {
    const manifest = await Bun.file(join(root, "package.json")).json()
    expect(manifest.scripts.storybook).toContain('from "@zavx0z/storybook-app"')
    expect(manifest.scripts.storybook).toContain("createApp().ensure")
    expect(manifest.scripts.build).toContain("createApp().check")
    expect(manifest.scripts.storybook).not.toContain("Bun.spawn")
    expect(manifest.bin).toBeUndefined()
  })

  test("keeps the one Storybook skill MCP-only and non-executable", async () => {
    const skill = await Bun.file(join(root, ".agents/skills/storybook/SKILL.md")).text()
    expect(skill).toContain("Использовать только MCP-инструменты `storybook_*`")
    expect(skill).toContain("storybook_search")
    expect(skill).toContain("storybook_capture")
    expect(skill).not.toContain("storybook.sh")
    expect(skill).not.toContain("targetId")
    expect(skill).not.toContain("ai-macos")
    expect(skill).not.toContain("@meta/chrome")
    expect(existsSync(join(root, ".agents/skills/storybook/scripts/storybook.sh"))).toBeFalse()
  })

  test("отдельный CLI не дублирует launcher", () => {
    expect(existsSync(join(root, "scripts/storybook.ts"))).toBeFalse()
    expect(existsSync(join(root, "server/cli.ts"))).toBeFalse()
  })
})
