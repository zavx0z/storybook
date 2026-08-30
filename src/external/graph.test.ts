import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {resolveExternalStorybookDeclarations} from "./declarations.ts"
import {
  createExternalStorybookGraph,
  externalStorybookNode,
  externalStorybookRoutes,
  resolveExternalStorybookRoute,
  searchExternalStorybookGraph,
} from "./graph.ts"

const fixtureRoot = join(import.meta.dir, "fixtures", "valid")

describe("external Storybook normalized graph", () => {
  test("builds deterministic canonical identities in owner semantic order", async () => {
    const declarations = await fixtureDeclarations()
    const first = createExternalStorybookGraph(declarations)
    const second = createExternalStorybookGraph(await fixtureDeclarations())

    expect(first.rootIds).toEqual([
      "workspace:fixture-workspace",
      "package:@fixture/standalone",
    ])
    expect(first.nodes.map(({id}) => id)).toEqual([
      "workspace:fixture-workspace",
      "project:fixture-alpha",
      "package:@fixture/components",
      "category:@fixture/components/foundation",
      "subject:@fixture/components/foundation/event-target",
      "category:@fixture/components/components",
      "subject:@fixture/components/components/button",
      "variant:@fixture/components/components/button/contained",
      "variant:@fixture/components/components/button/outlined",
      "project:fixture-beta",
      "package:@fixture/docs",
      "package:@fixture/standalone",
      "category:@fixture/standalone/tools",
      "subject:@fixture/standalone/tools/diagnostics",
    ])
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/u)
    expect(first.digest).toBe(second.digest)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(Object.isFrozen(first)).toBeTrue()
    expect(Object.isFrozen(first.nodes)).toBeTrue()
    expect(first.nodes.every((node) => Object.isFrozen(node) && Object.isFrozen(node.childIds))).toBeTrue()
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
  })

  test("keeps package, category and subject overviews distinct from variants", async () => {
    const graph = createExternalStorybookGraph(await fixtureDeclarations())
    const routes = externalStorybookRoutes(graph).filter(({packageId}) => packageId === "@fixture/components")

    expect(routes.map(({kind, path}) => [kind, path])).toEqual([
      ["overview", ""],
      ["overview", "foundation"],
      ["overview", "foundation/event-target"],
      ["overview", "components"],
      ["overview", "components/button"],
      ["variant", "components/button/basic/contained"],
      ["variant", "components/button/outlined"],
    ])
    expect(resolveExternalStorybookRoute(graph, "@fixture/components", "")).toMatchObject({
      kind: "overview",
      nodeId: "package:@fixture/components",
    })
    expect(resolveExternalStorybookRoute(graph, "@fixture/components", "foundation/event-target"))
      .toMatchObject({kind: "overview", nodeId: "subject:@fixture/components/foundation/event-target"})
    expect(resolveExternalStorybookRoute(graph, "@fixture/components", "components/button/basic/contained"))
      .toMatchObject({kind: "variant", nodeId: "variant:@fixture/components/components/button/contained"})
    expect(() => resolveExternalStorybookRoute(graph, "@fixture/components", "missing"))
      .toThrow("Unknown external Storybook route")
    expect(() => resolveExternalStorybookRoute(graph, "@fixture/components", "/components"))
      .toThrow("Malformed external Storybook route lookup")

    const subject = externalStorybookNode(
      graph,
      "subject:@fixture/components/foundation/event-target",
    )
    expect(subject.childIds).toEqual([])
    expect(subject.urlPath).toEndWith("/foundation/event-target/")
    expect(() => externalStorybookNode(graph, "variant:missing"))
      .toThrow("Unknown external Storybook graph identity")
  })

  test("keeps presentation groups as descriptors instead of semantic nodes", async () => {
    const graph = createExternalStorybookGraph(await fixtureDeclarations())
    expect(graph.nodes.some(({kind}) => (kind as string) === "group")).toBeFalse()
    expect(externalStorybookNode(graph, "category:@fixture/components/components").presentationGroup)
      .toEqual({id: "ui", label: "UI"})
    expect(externalStorybookNode(
      graph,
      "variant:@fixture/components/components/button/contained",
    ).presentationGroup).toEqual({id: "basic", label: "Basic"})
  })

  test("derives search from the same graph labels, API names, tags, aliases and routes", async () => {
    const graph = createExternalStorybookGraph(await fixtureDeclarations())
    expect(searchExternalStorybookGraph(graph, "кнопка").map(({id}) => id)).toEqual([
      "subject:@fixture/components/components/button",
    ])
    expect(searchExternalStorybookGraph(graph, "Button action").map(({id}) => id)).toEqual([
      "subject:@fixture/components/components/button",
    ])
    expect(searchExternalStorybookGraph(graph, "basic contained").map(({id}) => id)).toEqual([
      "variant:@fixture/components/components/button/contained",
    ])
    expect(searchExternalStorybookGraph(graph, "fixture workspace").map(({id}) => id)).toEqual([
      "workspace:fixture-workspace",
    ])
    expect(searchExternalStorybookGraph(graph, "")).toBe(graph.nodes)
  })

  test("records exact ownership, source, resources and stable structural paths", async () => {
    const graph = createExternalStorybookGraph(await fixtureDeclarations())
    const packageNode = externalStorybookNode(graph, "package:@fixture/components")
    expect(packageNode.authorStyleSheets.map(({specifier}) => specifier)).toEqual([
      "@fixture/components/tokens.css",
      "@fixture/components/theme.css",
    ])
    expect(packageNode.authorStyleSheets.every(({contentDigest}) => /^[a-f0-9]{64}$/u.test(contentDigest))).toBeTrue()
    expect(packageNode.widgetContributions).toMatchObject({
      protocol: "widget-contribution/1",
      items: [{id: "fixture-controls", kind: "component", label: "Fixture controls"}],
    })
    const subject = externalStorybookNode(
      graph,
      "subject:@fixture/components/components/button",
    )
    expect(subject.presentation).toEqual({
      protocol: "story-presentation/1",
      projection: "display",
      widgets: ["props", "source", "diagnostics"],
    })
    const variant = externalStorybookNode(
      graph,
      "variant:@fixture/components/components/button/contained",
    )
    expect(variant.ownerId).toBe("@fixture/components")
    expect(variant.packageId).toBe("@fixture/components")
    expect(variant.parentId).toBe("subject:@fixture/components/components/button")
    expect(variant.structuralPath).toEqual([
      "workspace:fixture-workspace",
      "project:fixture-alpha",
      "package:@fixture/components",
      "category:@fixture/components/components",
      "subject:@fixture/components/components/button",
      "variant:@fixture/components/components/button/contained",
    ])
    expect(variant.source.path).toEndWith("/.storybook/catalog.json")
    expect(variant.source.pointer).toBe("/categories/1/subjects/0/variants/0")
    expect(variant.module).toMatchObject({exportName: "contained"})
    expect(variant.resources.map(({kind}) => kind)).toEqual([
      "fixture",
      "test",
      "reference",
      "asset",
    ])
    expect(variant.authorStyleSheets).toEqual([])
    expect(variant.presentation).toBe(subject.presentation)
    expect(variant.widgetContributions).toBeNull()
    expect(variant.digest).toMatch(/^[a-f0-9]{64}$/u)
  })
})

async function fixtureDeclarations() {
  return resolveExternalStorybookDeclarations([
    fixtureRoot,
    join(fixtureRoot, "standalone"),
  ])
}
