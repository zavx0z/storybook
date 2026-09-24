import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {discoverStorybookPackages} from "../discovery/packages.ts"
import {
  createExternalStorybookGraph,
  externalStorybookNode,
  externalStorybookRoutes,
  resolveExternalStorybookRoute,
  searchExternalStorybookGraph,
} from "./graph.ts"

const fixtureRoot = join(import.meta.dir, "../discovery/fixtures/valid")
const fixture = () => discoverStorybookPackages([fixtureRoot, join(fixtureRoot, "standalone")])

describe("structural Storybook graph", () => {
  test("preserves package and directory identity in stable physical order", async () => {
    const first = createExternalStorybookGraph(await fixture())
    const second = createExternalStorybookGraph(await fixture())
    expect(first.rootIds).toEqual(["package:fixture-workspace", "package:@fixture/standalone"])
    expect(first.nodes.map(node => node.id)).toEqual([
      "package:fixture-workspace",
      "directory:package:fixture-workspace/projects",
      "package:fixture-alpha",
      "directory:package:fixture-alpha/packages",
      "package:@fixture/components",
      "directory:package:@fixture/components/docs",
      "package:fixture-beta",
      "directory:package:fixture-beta/packages",
      "package:@fixture/docs",
      "package:@fixture/standalone",
    ])
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/u)
    expect(first.digest).toBe(second.digest)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(Object.isFrozen(first.nodes)).toBeTrue()
    expect(first.nodes.every(node => Object.isFrozen(node) && Object.isFrozen(node.childIds))).toBeTrue()
  })

  test("routes package and directory overviews without virtual catalog nodes", async () => {
    const graph = createExternalStorybookGraph(await fixture())
    const packageId = "@fixture/components"
    expect(externalStorybookRoutes(graph).filter(route => route.packageId === packageId).map(({kind, path, urlPath}) => [kind, path, urlPath])).toEqual([
      ["overview", "", "/fixture-workspace/projects/alpha/packages/components"],
      ["overview", "dir-docs", "/fixture-workspace/projects/alpha/packages/components/docs"],
    ])
    expect(resolveExternalStorybookRoute(graph, packageId, "")).toMatchObject({nodeId: "package:@fixture/components", kind: "overview"})
    expect(resolveExternalStorybookRoute(graph, packageId, "dir-docs")).toMatchObject({nodeId: "directory:package:@fixture/components/docs", kind: "overview"})
    expect(() => resolveExternalStorybookRoute(graph, packageId, "missing")).toThrow("Unknown external Storybook route")
    expect(() => resolveExternalStorybookRoute(graph, packageId, "/docs")).toThrow("Malformed external Storybook route lookup")
  })

  test("keeps exact source ownership and containment", async () => {
    const graph = createExternalStorybookGraph(await fixture())
    const child = externalStorybookNode(graph, "package:@fixture/components")
    expect(child.parentId).toBe("directory:package:fixture-alpha/packages")
    expect(child.structuralPath).toEqual([
      "package:fixture-workspace",
      "directory:package:fixture-workspace/projects",
      "package:fixture-alpha",
      "directory:package:fixture-alpha/packages",
      "package:@fixture/components",
    ])
    expect(child.source.path).toEndWith("/projects/alpha/packages/components/package.json")
    expect(child.packageJsonPath).toBe(child.source.path)
    expect(child.urlPath).toBe("/fixture-workspace/projects/alpha/packages/components")
    expect(externalStorybookNode(graph, "directory:package:@fixture/components/docs").source.path).toEndWith("/components/docs")
    expect(() => externalStorybookNode(graph, "directory:missing")).toThrow("Unknown external Storybook graph identity")
  })

  test("derives search from package and directory names", async () => {
    const graph = createExternalStorybookGraph(await fixture())
    expect(searchExternalStorybookGraph(graph, "fixture workspace").map(node => node.id)).toEqual(["package:fixture-workspace"])
    expect(searchExternalStorybookGraph(graph, "components").some(node => node.id === "package:@fixture/components")).toBeTrue()
    expect(searchExternalStorybookGraph(graph, "")).toBe(graph.nodes)
  })

  test("rejects duplicate package URLs", async () => {
    const catalog = await fixture()
    const id = "package:@fixture/fixture-workspace"
    const scopes = catalog.scopes.map(scope => scope.id === "@fixture/standalone" && scope.kind === "package"
      ? {...scope, id: "@fixture/fixture-workspace", canonicalId: id, packageName: "@fixture/fixture-workspace"} : scope)
    const rootIds = catalog.rootIds.map(root => root === "package:@fixture/standalone" ? id : root)
    expect(() => createExternalStorybookGraph({...catalog, scopes, rootIds})).toThrow("Ambiguous Storybook package URL")
  })
})
