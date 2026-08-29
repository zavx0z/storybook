import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {parseExternalStorybookCli} from "./cli.ts"
import {resolveExternalStorybookDeclarations} from "./declarations.ts"
import {createExternalStorybookGraph, externalStorybookRoutes} from "./graph.ts"

const root = resolve(import.meta.dir, "../..")

describe("external Storybook self declaration", () => {
  test("uses the ordinary package path and preserves exact self routes", async () => {
    const graph = createExternalStorybookGraph(await resolveExternalStorybookDeclarations([root]))
    expect(graph.rootIds).toEqual(["package:@zavx0z/storybook"])
    const routes = externalStorybookRoutes(graph)
    const leaves = routes.filter(({kind}) => kind === "variant").map(({path}) => path)
    const overviews = routes.filter(({kind}) => kind === "overview").map(({path}) => path)
    expect(leaves).toEqual([
      "route-tree/contract/overview",
      "stories/contract/overview",
      "catalog/contract/overview",
      "workbench/contract/overview",
      "workbench/live/primary",
      "workbench/live/outlined",
      "workbench/live/disabled",
      "references/contract/overview",
      "app/contract/overview",
      "server/contract/overview",
      "launcher/contract/overview",
      "scaffold/contract/overview",
      "build/contract/overview",
      "environment/contract/overview",
    ])
    expect(overviews).toHaveLength(24)
    expect(overviews[0]).toBe("")
    expect(overviews).toContain("workbench/live")
    expect(overviews.some((path) => path.endsWith("/overview"))).toBeFalse()
    const categories = graph.nodes.filter(({kind}) => kind === "category")
    expect(categories.some(({presentationGroup}) => presentationGroup === null)).toBeTrue()
    expect(categories.some(({presentationGroup}) => presentationGroup !== null)).toBeTrue()
    const search = graph.nodes.flatMap(({searchTerms}) => searchTerms.map((value) => value.toLowerCase()))
    for (const term of [
      "mcp",
      "externalstorybookcontroller",
      "storybook_ensure",
      "lastworking",
      "package.code-updated",
      "package.resources-updated",
    ]) expect(search).toContain(term)
  })

  test("keeps the external bin, CLI actions and self contracts in lockstep", async () => {
    const packageManifest = await Bun.file(resolve(root, "package.json")).json() as {
      bin?: Record<string, string>
    }
    expect(packageManifest.bin).toEqual({storybook: "./scripts/storybook.ts"})
    const samples = [
      ["serve"],
      ["attach", "."],
      ["detach", "project-id"],
      ["open", "@ui/components"],
      ["status"],
      ["check", "."],
      ["stop"],
      ["init", ".", "--kind", "project"],
    ] as const
    const actions = samples.map((args) => parseExternalStorybookCli(args).action)
    expect(actions).toEqual(["serve", "attach", "detach", "open", "status", "check", "stop", "init"])
    const selfContracts = await Bun.file(resolve(root, ".storybook/stories/contracts.ts")).text()
    for (const action of actions) expect(selfContracts).toContain(`storybook ${action}`)
  })

  test("keeps its owner runtime and stories free of Storybook imports", async () => {
    for (const path of [
      ".storybook/runtime.ts",
      ".storybook/stories/contracts.ts",
      ".storybook/stories/workbench.ts",
    ]) {
      expect(await Bun.file(resolve(root, path)).text(), path).not.toContain("@zavx0z/storybook")
    }
  })
})
