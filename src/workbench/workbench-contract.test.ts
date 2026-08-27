import {describe, expect, test} from "bun:test"
import {
  StorybookBackdropSurface,
  planStorybookPreviewContent,
  planStorybookShell,
  type StorybookResponsivePolicy,
} from "../workbench.ts"

const readSource = (path: string): Promise<string> => Bun.file(new URL(path, import.meta.url)).text()

describe("shared Workbench owner boundaries", () => {
  test("exposes the Workbench only through its intentional public subpath entry", () => {
    const responsive: StorybookResponsivePolicy = {compactBelow: null, compactPanels: []}
    expect(planStorybookShell(1920, 1080, {responsive}).compact).toBeFalse()
    expect(StorybookBackdropSurface.name).toBe("StorybookBackdropSurface")
  })

  test("plans consumer preview content below the shared chrome", () => {
    const blank = planStorybookPreviewContent(900, 600)
    const title = planStorybookPreviewContent(900, 600, {title: "Title"})
    const full = planStorybookPreviewContent(900, 600, {title: "Title", description: "Description"})

    expect(blank.x).toBeGreaterThan(0)
    expect(blank.w).toBeLessThan(900)
    expect(title.y).toBeGreaterThan(blank.y)
    expect(full.y).toBeGreaterThan(title.y)
    expect(full.y + full.h).toBeLessThan(600)
  })

  test("uses exact Layout and UI leaves without product-specific imports", async () => {
    const [layout, surfaces, theme, shellTheme] = await Promise.all([
      readSource("./layout.ts"),
      readSource("./surfaces.ts"),
      readSource("./theme.ts"),
      readSource("../shell-theme.ts"),
    ])
    const source = [layout, surfaces, theme, shellTheme].join("\n")

    expect(layout).toContain('from "@layout/core/flex-css"')
    expect(surfaces).toContain('from "@layout/core/flex"')
    expect(surfaces).toContain('from "@layout/core/surface"')
    expect(surfaces).toContain('from "@ui/components/code-editor"')
    expect(theme).toContain('from "@ui/elements/shape"')
    expect(shellTheme).toContain('from "@ui/elements/theme-reference"')
    expect(surfaces).toContain("STORYBOOK_SHELL_BACKGROUND_RGBA")
    expect(source).not.toMatch(/from "@ui\/(?:components|elements)"/)
    expect(source).not.toMatch(/@nodes\/|@metafor\//)
  })

  test("delegates Flex, retained ownership and shaped child clipping to their exact owners", async () => {
    const [layout, surfaces] = await Promise.all([
      readSource("./layout.ts"),
      readSource("./surfaces.ts"),
    ])

    expect(layout).toContain("flexRowCss")
    expect(layout).toContain("flexColumnCss")
    expect(surfaces).toContain("createRetainedParent")
    expect(surfaces).toContain("materializeRetainedParent")
    expect(surfaces).toContain("Pane(")
    expect(surfaces).toContain("div(")
    expect(surfaces).not.toContain("pushClip(")
    expect(surfaces).not.toContain("popClip(")
  })

  test("keeps three independently owned source editors read-only and Workbench actions in Russian", async () => {
    const surfaces = await readSource("./surfaces.ts")

    expect(surfaces).toContain("CodeEditor(this")
    expect(surfaces).toContain('["html", "css", "typescript"]')
    expect(surfaces).toContain("key: storySourceScrollKey(boxKind)")
    expect(surfaces).toContain("languageId: boxKind")
    expect(surfaces).toContain("readOnly: true")
    expect(surfaces).toContain("Inspector(this")
    expect(surfaces).toContain('label: `Копировать ${label}`')
    expect(surfaces).toContain('selectedCategoryId: this.#options.category')
    expect(surfaces).toContain('searchPlaceholder ?? "Поиск…"')
  })

  test("owns Blender-like editor and panel radii directly in Workbench styles", async () => {
    const surfaces = await readSource("./surfaces.ts")

    expect(surfaces).toContain("borderRadius: 6")
    expect(surfaces).toContain("borderRadius: 4")
    expect(surfaces).not.toMatch(/uiShapeMetrics\.(?:lowRadius|panelRadius|editorAreaRadius)/u)
  })
})
