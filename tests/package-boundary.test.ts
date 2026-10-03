import {describe, expect, test} from "bun:test"
import {existsSync} from "node:fs"
import {join, resolve} from "node:path"

const root = resolve(import.meta.dir, "..")

describe("external @zavx0z/storybook tool boundary", () => {
  test("publishes one application script and no consumer code API", async () => {
    const manifest = await Bun.file(join(root, "package.json")).json() as Record<string, any>
    expect(manifest.private).toBeTrue()
    expect(manifest.exports).toBeUndefined()
    expect(manifest.bin).toBeUndefined()
    expect(manifest.peerDependencies).toBeUndefined()
    expect(manifest.peerDependenciesMeta).toBeUndefined()
    expect(manifest.dependencies["@storybook/app"]).toBe("workspace:*")
    expect(manifest.scripts.storybook).toContain('import createApp from "@storybook/app"')
    expect(manifest.scripts.storybook).toContain("createApp().ensure(")
    expect(manifest.scripts.serve).toBe("bun run storybook")
  })

  test("runs multi-package isolation in its own explicit process", async () => {
    const manifest = await Bun.file(join(root, "package.json")).json() as Record<string, any>
    const script = manifest.scripts.test as string
    expect(script).toContain("bun test --no-orphans --isolate --preload @immersive/headless/preload ./app ./tech ./chat ./project ./repo ./package ./specs ./domain ./cluster ./component ./container ./contracts ./typedoc ./tests --max-concurrency=1")
    const ignored = script.match(/--path-ignore-patterns '([^']+)'/u)?.[1]
    expect(ignored, "Основной процесс явно исключает изолированную проверку и фикстуры").toBeDefined()
    const paths = new Bun.Glob(ignored!)
    expect(paths.match("tests/isolation.integration.test.ts")).toBeTrue()
    expect(paths.match("owner/spec/fixture/scenario.spec.ts")).toBeTrue()
    expect(paths.match("repo/discovery/fixtures/sample.test.ts")).toBeTrue()
    expect(paths.match("tests/package-boundary.test.ts")).toBeFalse()
    expect(script).toContain("&& bun test --no-orphans --isolate ./tests/isolation.integration.test.ts --max-concurrency=1")
    expect(script).not.toContain("server.test.ts")
  })

  test("предметный прогон выбирает точные каталоги и изолирует состояние файлов", async () => {
    const manifest = await Bun.file(join(root, "package.json")).json() as Record<string, any>
    expect(manifest.scripts["subjects:check"]).toBe(
      "bun test --no-orphans --isolate --preload @immersive/headless/preload ./chat ./project ./repo ./package ./specs ./domain ./cluster ./component ./container ./contracts ./typedoc --path-ignore-patterns '**/{fixture,fixtures}/**' --max-concurrency=1",
    )
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

  test("self documentation follows its package structure", async () => {
    const manifest = await Bun.file(join(root, "package.json")).json()
    expect(manifest.name).toBe("@zavx0z/storybook")
    expect(await Bun.file(join(root, "README.md")).text()).toContain("Storybook")
    expect(existsSync(join(root, ".storybook"))).toBeFalse()
  })

  test("shared browser shell uses one public Browser Root without low-level owners", async () => {
    const sources = await Promise.all([
      "app/web/page/shell/index.ts",
      "app/web/page/home/index.ts",
      "app/web/page/package/index.ts",
      "app/web/page/index.ts",
      "app/web/src/browser-entry.ts",
    ].map((path) => Bun.file(join(root, path)).text()))
    const combined = sources.join("\n")
    expect(combined).toContain('from "@zavx0z/browser/integration"')
    expect(combined).toContain("createBrowserRoot")
    expect(combined).toContain("application.render(")
    expect(combined).toContain("root.document")
    expect(combined).toContain("root.space")
    expect(combined).toContain("root.viewPoint")
    const app = await Bun.file(join(root, "app/web/page/shell/src/application.tsx")).text()
    expect(app).toContain("<Workbench")
    expect(combined).toContain("mountSpacePreview")
    expect(combined).not.toContain("createDocumentSpaceRuntime")
    expect(combined).not.toContain("DocumentSpaceRuntime")
    expect(combined).not.toContain("DocumentOverlayRuntime")
    expect(combined).not.toContain("nativeInputHost")
    expect(combined).not.toContain("workbenchOverlay")
    expect(combined).not.toContain("mountWorldPreview")
    expect(combined).not.toContain("requestAnimationFrame")
    expect(combined).not.toContain("createDocumentCanvasRuntime")
    expect(combined).not.toMatch(/from ["']@zavx0z\/storybook(?:\/[^"']*)?["']/u)
    expect(combined).not.toContain("UiSurface")
    expect(combined).not.toContain("@layout/core")
    expect(combined).not.toContain("@ui/elements")
    expect(combined).not.toContain("StorybookDom")
    expect(combined).not.toContain("STORYBOOK_DOM")
    expect(combined, "Внутреннее состояние рабочей области не является соседним публичным пакетом")
      .not.toContain('from "@web/workbench-model"')
    expect(app).toContain('from "@web/workbench"')
    expect(combined).not.toContain("createDocumentSpaceRuntime")
  })
})
