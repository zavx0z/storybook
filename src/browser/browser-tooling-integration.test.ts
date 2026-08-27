import {describe, expect, test} from "bun:test"
import {join} from "node:path"

const browserScript = join(import.meta.dir, "../../scripts/storybook-browser.ts")
const launcherScript = join(import.meta.dir, "../../scripts/storybook.ts")

describe("package-name Storybook browser tooling", () => {
  test("derives runtime and page capability without a consumer registry or port", async () => {
    const source = await Bun.file(browserScript).text()
    expect(source).toContain('from "@zavx0z/storybook/launcher"')
    expect(source).toContain("packageStatus.runtime.manifestPath")
    expect(source).toContain("manifest.pages.find(({routes}) => routes.includes(route))")
    expect(source).toContain("STORYBOOK_CDP_PORT")
    expect(source).not.toContain("storybooks.json")
    expect(source).not.toContain("NODES_DEV_")
    expect(source).not.toContain("UI_DEV_")
    expect(source).not.toMatch(/127\.0\.0\.1:40\d\d/u)
    expect(source).not.toContain("config.selector")
  })

  test("serializes creation and revalidates the target before background readiness", async () => {
    const source = await Bun.file(browserScript).text()
    const creationLock = source.indexOf("await withTargetCreationLock({")
    const creationScope = source.indexOf("creationScope: config.origin", creationLock)
    const initialSelect = source.indexOf("selectTarget(config, true", creationScope)
    const operationLock = source.indexOf("withTargetOperationLock({targetId: target.id, cdpPort}")
    const reselect = source.indexOf("const lockedSelection = await selectTarget", operationLock)
    const ready = source.indexOf("await runWithBackgroundFrameScheduling", reselect)
    const presented = source.indexOf("await waitPresentedFrameBoundary(cdp)", ready)
    expect(creationLock).toBeGreaterThan(-1)
    expect(creationScope).toBeGreaterThan(creationLock)
    expect(initialSelect).toBeGreaterThan(creationScope)
    expect(operationLock).toBeGreaterThan(initialSelect)
    expect(reselect).toBeGreaterThan(operationLock)
    expect(ready).toBeGreaterThan(reselect)
    expect(presented).toBeGreaterThan(ready)
  })

  test("opens and activates one exact target on the first package start", async () => {
    const [browserSource, launcherSource] = await Promise.all([
      Bun.file(browserScript).text(),
      Bun.file(launcherScript).text(),
    ])
    expect(browserSource).toContain('cdp.send("Target.createTarget", {url, background: true})')
    expect(browserSource).toContain('cdp.send("Target.activateTarget", {targetId})')
    expect(browserSource).toContain("readStorybookBrowserTargetRecord(targetOwner)")
    expect(browserSource).toContain("writeStorybookBrowserTargetRecord(owner, created.id)")
    expect(browserSource).toContain("recordedTarget.url !== config.targetUrl")
    expect(launcherSource).toContain('launched.outcome === "started" && openOnStart')
    expect(launcherSource).toContain('action !== "restart"')
    expect(launcherSource).toContain('action === "restart"')
    expect(launcherSource).toContain('...(activate ? ["--activate"] : [])')
    expect(launcherSource).toContain('...(preserveRoute ? ["--preserve-route"] : [])')
    expect(browserSource).toContain("await recordedTargetRoute(targetOwner, developmentManifest, cdpPort)")
    expect(browserSource).toContain("routes.includes(pathname)")
    expect(launcherSource).toContain('argument === "--no-open"')
  })
})
