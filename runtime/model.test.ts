import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {
  resolveExternalStorybookDeclarations,
} from "../discovery/declarations.ts"
import {createExternalStorybookGraph} from "../catalog/graph.ts"
import {
  deriveExternalStorybookLanding,
  deriveExternalStorybookLandingSelection,
  deriveExternalStorybookNavigationTree,
  deriveExternalStorybookPackageTab,
} from "./model.ts"

const fixtureRoot = join(import.meta.dir, "../discovery/fixtures/valid")

describe("external Storybook browser model", () => {
  test("projects repositories and packages into one hierarchy", async () => {
    const graph = await fixtureGraph()
    const landing = deriveExternalStorybookLanding(graph)
    expect(landing.catalogItems.map(item => [item.id, item.parentId ?? null])).toEqual([
      ["package:fixture-workspace", null],
      ["package:fixture-alpha", "package:fixture-workspace"],
      ["package:@fixture/components", "package:fixture-alpha"],
      ["package:fixture-beta", "package:fixture-workspace"],
      ["package:@fixture/docs", "package:fixture-beta"],
      ["package:@fixture/standalone", null],
    ])
    expect(landing.catalogItems.find(item => item.id === "package:@fixture/components")?.route).toBe("/fixture-workspace/projects/alpha/packages/components")
  })

  test("одна навигация продолжает пакет до предмета и берёт его данные из применённой ревизии", async () => {
    const graph = await fixtureGraph()
    const subjectId = "subject:@fixture/components/components/button"
    const applied = {...graph, nodes: graph.nodes.map(node => node.id === subjectId
      ? {...node, label: "Применённая кнопка"} : node)}
    const items = deriveExternalStorybookNavigationTree(graph, {packageId: "@fixture/components", graph: applied})
    const packageNode = items.find(item => item.id === "package:@fixture/components")!
    const category = items.find(item => item.id === "category:@fixture/components/components")!
    const subject = items.find(item => item.id === subjectId)!
    expect([packageNode.parentId, category.parentId, subject.parentId]).toEqual([
      "package:fixture-alpha", packageNode.id, category.id,
    ])
    expect(subject.label).toBe("Применённая кнопка")
    expect(items.some(item => item.id.startsWith("variant:"))).toBeFalse()
    expect(new Set(items.map(item => item.id)).size).toBe(items.length)
  })

  test("отделяет представление сценариев от одноимённой сущности", async () => {
    const base = await fixtureGraph()
    const subject = base.nodes.find(node => node.id === "subject:@fixture/components/components/button")!
    const child = {...subject, id: "directory:package:@fixture/components/components/button/scenarios", kind: "directory" as const,
      parentId: subject.id, childIds: [], routePath: "dir-components/dir-button/dir-scenarios", urlPath: `${subject.urlPath}/scenarios`}
    const graph = {...base, nodes: [...base.nodes.map(node => node.id === subject.id
      ? {...node, scenariosRoutePath: "components/button/scenarios"} : node), child]}
    const scenarios = deriveExternalStorybookPackageTab(graph, "@fixture/components", "components/button/scenarios")
    const entity = deriveExternalStorybookPackageTab(graph, "@fixture/components", child.routePath)
    expect([scenarios.urlPath, entity.urlPath]).toEqual([
      `${subject.urlPath}?view=scenarios`, `${subject.urlPath}/scenarios`,
    ])
  })

  test("выбирает обзор из того же дерева репозиториев и пакетов", async () => {
    const graph = await fixtureGraph()
    const selected = deriveExternalStorybookLandingSelection(graph, "package:@fixture/components")
    expect(selected.overviewNode.id).toBe("package:@fixture/components")
    expect(deriveExternalStorybookLandingSelection(graph, "package:fixture-workspace").overviewNode.id).toBe("package:fixture-workspace")
    expect(() => deriveExternalStorybookLandingSelection(graph, "subject:@fixture/components/components/button"))
      .toThrow("must be a repository or package")
  })

  test("пакетный обзор не выбирает дочерний предмет", async () => {
    const graph = await fixtureGraph()
    const model = deriveExternalStorybookPackageTab(graph, "@fixture/components", "")

    expect(model.selectedNode.id).toBe("package:@fixture/components")
    expect(deriveExternalStorybookNavigationTree(graph).filter(item => item.parentId === model.packageNode.id && item.id.startsWith("category:")).map(({id}) => id)).toEqual([
      "category:@fixture/components/foundation",
      "category:@fixture/components/components",
    ])
    expect(model.categoryId).toBeNull()
    expect(model.subjectId).toBeNull()
    expect(model.variants).toEqual([])
  })

  test("keeps category and subject overview states separate from an exact variant", async () => {
    const graph = await fixtureGraph()
    const category = deriveExternalStorybookPackageTab(graph, "@fixture/components", "components")
    expect(category.selectedNode.kind).toBe("category")
    expect(category.categoryId).toBe("category:@fixture/components/components")
    expect(category.subjectId).toBeNull()
    expect(category.variants).toEqual([])

    const subject = deriveExternalStorybookPackageTab(graph, "@fixture/components", "components/button")
    expect(subject.selectedNode.kind).toBe("subject")
    expect(subject.subjectId).toBe("subject:@fixture/components/components/button")
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
    expect(variant.categoryId).toBe("category:@fixture/components/components")
    expect(variant.subjectId).toBe("subject:@fixture/components/components/button")
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
