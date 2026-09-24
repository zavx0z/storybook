import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {discoverStorybookPackages} from "../discovery/packages.ts"
import {createExternalStorybookGraph} from "../catalog/graph.ts"
import {
  deriveExternalStorybookLanding,
  deriveExternalStorybookLandingSelection,
  deriveExternalStorybookNavigationTree,
  deriveExternalStorybookPackageTab,
} from "./model.ts"

const fixtureRoot = join(import.meta.dir, "../discovery/fixtures/valid")
const fixtureGraph = async () => createExternalStorybookGraph(await discoverStorybookPackages([
  fixtureRoot, join(fixtureRoot, "standalone"),
]))

describe("structural browser model", () => {
  test("shows physical package owners in the landing hierarchy", async () => {
    const graph = await fixtureGraph()
    const landing = deriveExternalStorybookLanding(graph)
    expect(landing.catalogItems.map(item => [item.id, item.parentId ?? null])).toEqual([
      ["package:fixture-workspace", null],
      ["package:fixture-alpha", "directory:package:fixture-workspace/projects"],
      ["package:@fixture/components", "directory:package:fixture-alpha/packages"],
      ["package:fixture-beta", "directory:package:fixture-workspace/projects"],
      ["package:@fixture/docs", "directory:package:fixture-beta/packages"],
      ["package:@fixture/standalone", null],
    ])
    expect(landing.catalogItems.find(item => item.id === "package:@fixture/components")?.route).toBe("/fixture-workspace/projects/alpha/packages/components")
    expect(deriveExternalStorybookLandingSelection(graph, "directory:package:fixture-workspace/projects").overviewNode.kind).toBe("directory")
  })

  test("uses the applied revision for one package and retains its position", async () => {
    const graph = await fixtureGraph()
    const packageId = "@fixture/components"
    const packageNodeId = `package:${packageId}`
    const directoryId = `directory:${packageNodeId}/docs`
    const applied = {...graph, rootIds: [packageNodeId], nodes: graph.nodes.filter(node => node.packageId === packageId)
      .map(node => node.id === packageNodeId ? {...node, label: "Применённый пакет", parentId: null}
        : node.id === directoryId ? {...node, label: "Применённая документация"} : node)}
    const items = deriveExternalStorybookNavigationTree(graph, {packageId, graph: applied})
    const owner = items.find(item => item.id === packageNodeId)!
    const directory = items.find(item => item.id === directoryId)!
    expect(owner.parentId).toBe("directory:package:fixture-alpha/packages")
    expect(owner.title).toBe("Применённый пакет")
    expect(directory.label).toBe("Применённая документация")
    expect(new Set(items.map(item => item.id)).size).toBe(items.length)
  })

  test("package and directory overviews select exactly one physical node", async () => {
    const graph = await fixtureGraph()
    const owner = deriveExternalStorybookPackageTab(graph, "@fixture/components", "")
    expect(owner.selectedNode.id).toBe("package:@fixture/components")
    expect(owner.viewKind).toBe("overview")
    expect(owner.tabs.map(tab => tab.label)).toEqual(["Обзор"])
    const directory = deriveExternalStorybookPackageTab(graph, "@fixture/components", "dir-docs")
    expect(directory.selectedNode.id).toBe("directory:package:@fixture/components/docs")
    expect(directory.urlPath).toBe("/fixture-workspace/projects/alpha/packages/components/docs")
    expect(() => deriveExternalStorybookPackageTab(graph, "@fixture/components", "missing")).toThrow("Unknown or ambiguous external Storybook route")
  })
})
