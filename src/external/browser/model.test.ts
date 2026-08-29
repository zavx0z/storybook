import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {resolveExternalStorybookDeclarations} from "../declarations.ts"
import {createExternalStorybookGraph} from "../graph.ts"
import {
  deriveExternalStorybookLanding,
  deriveExternalStorybookLandingSelection,
  deriveExternalStorybookPackageTab,
} from "./model.ts"

const fixtureRoot = join(import.meta.dir, "..", "fixtures", "valid")

describe("external Storybook browser model", () => {
  test("projects workspace children as grouped rows and independent roots as direct rows", async () => {
    const graph = await fixtureGraph()
    const landing = deriveExternalStorybookLanding(graph)

    expect(landing.catalogItems.map(({id}) => id)).toEqual([
      "project:fixture-alpha",
      "project:fixture-beta",
      "package:@fixture/standalone",
    ])
    expect(landing.catalogItems.slice(0, 2).map(({group}) => group)).toEqual([
      {id: "workspace:fixture-workspace", label: "Fixture Workspace"},
      {id: "workspace:fixture-workspace", label: "Fixture Workspace"},
    ])
    expect(landing.catalogItems[2]?.group).toBeNull()
    expect(landing.catalogItems.some(({id}) => id === "workspace:fixture-workspace")).toBeFalse()
    expect("route" in landing.catalogItems[0]!.group!).toBeFalse()
    expect(landing.catalogItems[0]?.searchText).toContain("components")
    expect(Object.isFrozen(landing)).toBeTrue()
    expect(Object.isFrozen(landing.catalogItems)).toBeTrue()
  })

  test("selects project/package overviews and derives the exact package second panel", async () => {
    const graph = await fixtureGraph()
    const project = deriveExternalStorybookLandingSelection(graph, "project:fixture-alpha")
    expect(project.catalogActiveId).toBe("project:fixture-alpha")
    expect(project.secondaryItems.map(({id}) => id)).toEqual(["package:@fixture/components"])
    expect(project.secondaryActiveId).toBeNull()
    expect(project.overviewNode.id).toBe("project:fixture-alpha")
    expect(project.overviewNode.kind).toBe("project")

    const nestedPackage = deriveExternalStorybookLandingSelection(graph, "package:@fixture/components")
    expect(nestedPackage.catalogActiveId).toBe("project:fixture-alpha")
    expect(nestedPackage.secondaryActiveId).toBe("package:@fixture/components")
    expect(nestedPackage.overviewNode.id).toBe("package:@fixture/components")

    const standalone = deriveExternalStorybookLandingSelection(graph, "package:@fixture/standalone")
    expect(standalone.catalogActiveId).toBe("package:@fixture/standalone")
    expect(standalone.secondaryItems).toEqual([])
    expect(standalone.overviewNode.id).toBe("package:@fixture/standalone")

    expect(() => deriveExternalStorybookLandingSelection(graph, "workspace:fixture-workspace"))
      .toThrow("workspace group toggle is not a route")
    expect(() => deriveExternalStorybookLandingSelection(
      graph,
      "subject:@fixture/components/components/button",
    )).toThrow("must be a project or package")
  })

  test("projects direct and optionally grouped categories without creating group routes", async () => {
    const graph = await fixtureGraph()
    const model = deriveExternalStorybookPackageTab(graph, "@fixture/components", "")

    expect(model.selectedNode.id).toBe("package:@fixture/components")
    expect(model.catalogItems.map(({id}) => id)).toEqual([
      "category:@fixture/components/foundation",
      "category:@fixture/components/components",
    ])
    expect(model.catalogItems[0]?.group).toBeNull()
    expect(model.catalogItems[1]?.group).toEqual({id: "ui", label: "UI"})
    expect("route" in model.catalogItems[1]!.group!).toBeFalse()
    expect(model.catalogItems[0]?.searchText).toContain("event-target")
    expect(model.catalogItems[1]?.searchText).toContain("кнопка")
    expect(model.catalogActiveId).toBeNull()
    expect(model.secondaryItems).toEqual([])
    expect(model.variants).toEqual([])
  })

  test("keeps category and subject overview states separate from an exact variant", async () => {
    const graph = await fixtureGraph()
    const category = deriveExternalStorybookPackageTab(graph, "@fixture/components", "components")
    expect(category.selectedNode.kind).toBe("category")
    expect(category.catalogActiveId).toBe("category:@fixture/components/components")
    expect(category.secondaryItems.map(({id}) => id)).toEqual([
      "subject:@fixture/components/components/button",
    ])
    expect(category.secondaryActiveId).toBeNull()
    expect(category.variants).toEqual([])

    const subject = deriveExternalStorybookPackageTab(graph, "@fixture/components", "components/button")
    expect(subject.selectedNode.kind).toBe("subject")
    expect(subject.secondaryActiveId).toBe("subject:@fixture/components/components/button")
    expect(subject.variantActiveId).toBeNull()
    expect(subject.variants.map(({id}) => id)).toEqual([
      "variant:@fixture/components/components/button/contained",
      "variant:@fixture/components/components/button/outlined",
    ])
    expect(subject.variants.map(({group}) => group)).toEqual([
      {id: "basic", label: "Basic"},
      {id: "basic", label: "Basic"},
    ])
    expect(subject).not.toHaveProperty("sections")

    const variant = deriveExternalStorybookPackageTab(
      graph,
      "@fixture/components",
      "components/button/basic/contained",
    )
    expect(variant.selectedNode.kind).toBe("variant")
    expect(variant.selectedNode.id).toBe("variant:@fixture/components/components/button/contained")
    expect(variant.variantActiveId).toBe("variant:@fixture/components/components/button/contained")
    expect(variant.catalogActiveId).toBe("category:@fixture/components/components")
    expect(variant.secondaryActiveId).toBe("subject:@fixture/components/components/button")
  })

  test("supports variant-free subject overviews and fails closed for unknown package routes", async () => {
    const graph = await fixtureGraph()
    const subject = deriveExternalStorybookPackageTab(
      graph,
      "@fixture/components",
      "foundation/event-target",
    )
    expect(subject.selectedNode.id).toBe("subject:@fixture/components/foundation/event-target")
    expect(subject.variants).toEqual([])
    expect(subject.variantActiveId).toBeNull()

    expect(() => deriveExternalStorybookPackageTab(graph, "@fixture/components", "missing"))
      .toThrow("Unknown external Storybook route")
    expect(() => deriveExternalStorybookPackageTab(graph, "@fixture/missing", ""))
      .toThrow("Unknown external Storybook graph identity")
  })
})

async function fixtureGraph() {
  return createExternalStorybookGraph(await resolveExternalStorybookDeclarations([
    fixtureRoot,
    join(fixtureRoot, "standalone"),
  ]))
}
