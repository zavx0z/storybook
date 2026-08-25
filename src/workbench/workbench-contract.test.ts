import {describe, expect, test} from "bun:test"
import {
  StorybookBackdropSurface,
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

  test("uses exact Layout and UI leaves without product-specific imports", async () => {
    const [layout, surfaces, theme] = await Promise.all([
      readSource("./layout.ts"),
      readSource("./surfaces.ts"),
      readSource("./theme.ts"),
    ])
    const source = [layout, surfaces, theme].join("\n")

    expect(layout).toContain('from "@layout/core/flex-css"')
    expect(surfaces).toContain('from "@layout/core/flex"')
    expect(surfaces).toContain('from "@layout/core/surface"')
    expect(surfaces).toContain('from "@ui/components/code-editor"')
    expect(theme).toContain('from "@ui/elements/shape"')
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

  test("keeps source read-only and Workbench actions in Russian", async () => {
    const surfaces = await readSource("./surfaces.ts")

    expect(surfaces).toContain("CodeEditor(this")
    expect(surfaces).toContain("readOnly: true")
    expect(surfaces).toContain('children: "Копировать"')
    expect(surfaces).toContain('mode === "controls" ? "Параметры" : "События"')
    expect(surfaces).toContain('searchPlaceholder ?? "Поиск…"')
  })
})
