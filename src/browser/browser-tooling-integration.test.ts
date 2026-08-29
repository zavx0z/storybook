import {describe, expect, test} from "bun:test"
import {join} from "node:path"

const browserScript = join(import.meta.dir, "../../scripts/storybook-browser.ts")
const launcherScript = join(import.meta.dir, "../../scripts/storybook.ts")

describe("external Storybook browser tooling", () => {
  test("derives one server origin and exact package URLs without a consumer registry", async () => {
    const source = await Bun.file(browserScript).text()
    expect(source).toContain('from "../src/external/server-state.ts"')
    expect(source).toContain('new URL("/api/client", origin)')
    expect(source).toContain("node.packageId === scope && node.routePath === path")
    expect(source).toContain("encodeURIComponent(scope)")
    expect(source).toContain("landingPath(parsed.pathname)")
    expect(source).toContain("projects|workspaces")
    expect(source).not.toContain("resolveStorybookPackage")
    expect(source).not.toContain("StorybookDevelopmentManifest")
    expect(source).not.toContain("storybooks.json")
    expect(source).not.toContain("STORYBOOK_CDP_PORT")
  })

  test("checks the canonical Chrome service and targets every operation by stable CDP identity", async () => {
    const source = await Bun.file(browserScript).text()
    expect(source).toContain('fetch(`${CHROME_ORIGIN}/health`')
    expect(source).toContain('chromeJson("/cdp/targets")')
    expect(source).toContain("targetId: target.id")
    expect(source).toContain("id: target.targetId")
    expect(source).toContain("Multiple Storybook targets are open; pass --target-id")
    expect(source).not.toContain('chromeJson("/windows")')
    expect(source).not.toContain("windowId: target.windowId")
    expect(source).not.toContain("tabIndex: target.tabIndex")
    expect(source).not.toContain("/tabs/active")
    expect(source).not.toContain("front window")
    expect(source).not.toContain("osascript")
  })

  test("captures with an explicit expectation and keeps canvas evidence package-scoped", async () => {
    const source = await Bun.file(browserScript).text()
    expect(source).toContain('chromeRequest("/cdp/screenshot"')
    expect(source).toContain("targetId: target.id")
    expect(source).toContain("caption: `Ожидаю увидеть готовый")
    expect(source).toContain('candidate.id !== "external-storybook-canvas"')
    expect(source).toContain('canvas.toDataURL("image/png")')
    expect(source).toContain('`/packages/${encodeURIComponent(scope)}/`')
  })

  test("launcher exposes only the one-server CLI", async () => {
    const source = await Bun.file(launcherScript).text()
    expect(source).toContain("runExternalStorybookCli")
    expect(source).not.toContain("launchStorybookPackage")
    expect(source).not.toContain("openStartedBrowserTarget")
  })
})
