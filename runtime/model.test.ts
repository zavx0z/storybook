import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {
  resolveExternalStorybookDeclarations,
} from "../discovery/declarations.ts"
import {createExternalStorybookGraph} from "../catalog/graph.ts"
import {
  deriveExternalStorybookLanding,
  deriveExternalStorybookLandingSelection,
  deriveExternalStorybookPackageTab,
} from "./model.ts"

const fixtureRoot = join(import.meta.dir, "../discovery/fixtures/valid")

describe("external Storybook browser model", () => {
  test("projects repositories and packages into one hierarchy", async () => {
    const graph = await fixtureGraph()
    const landing = deriveExternalStorybookLanding(graph)
    expect(landing.catalogItems.map(item => [item.id, item.parentId ?? null])).toEqual([
      ["workspace:fixture-workspace", null],
      ["project:fixture-alpha", "workspace:fixture-workspace"],
      ["package:@fixture/components", "project:fixture-alpha"],
      ["project:fixture-beta", "workspace:fixture-workspace"],
      ["package:@fixture/docs", "project:fixture-beta"],
      ["project:fixture-standalone", null],
      ["package:@fixture/standalone", "project:fixture-standalone"],
    ])
    expect(landing.catalogItems.find(item => item.id === "package:@fixture/components")?.route).toBe("/browse/%40fixture%2Fcomponents/")
  })

  test("selects repositories as overviews and places package contents in the second panel", async () => {
    const graph = await fixtureGraph()
    expect(deriveExternalStorybookLandingSelection(graph, "project:fixture-alpha").secondaryItems.map(item => item.label)).toEqual(["packages"])
    const selected = deriveExternalStorybookLandingSelection(graph, "package:@fixture/components")
    expect(selected.catalogActiveId).toBe("package:@fixture/components")
    expect(selected.secondaryItems.filter(item => !item.id.startsWith("directory:")).map(item => item.id)).toEqual([
      "category:@fixture/components/foundation", "subject:@fixture/components/foundation/event-target",
      "category:@fixture/components/components", "subject:@fixture/components/components/button",
    ])
    expect(selected.secondaryItems[1]?.parentId).toBe("category:@fixture/components/foundation")
    expect(deriveExternalStorybookLandingSelection(graph, "workspace:fixture-workspace").secondaryItems.map(item => item.label)).toEqual(["projects"])
    expect(() => deriveExternalStorybookLandingSelection(graph, "subject:@fixture/components/components/button"))
      .toThrow("must be a repository or package")
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
