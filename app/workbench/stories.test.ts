import {describe, expect, test} from "bun:test"
import {
  STORYBOOK_WORKBENCH_STORIES,
  storybookWorkbenchPresentationRoute,
} from "./stories.ts"
import {STORYBOOK_DOCUMENTATION_MODULES} from "../contracts/examples.ts"

describe("self-documenting Storybook stories", () => {
  test("keeps overview paths separate from their presentation story", () => {
    expect(STORYBOOK_WORKBENCH_STORIES.routeTree.leaves).toContain("route-tree/contract/overview")
    expect(STORYBOOK_WORKBENCH_STORIES.routeTree.leaves).toContain("stories/contract/overview")
    expect(STORYBOOK_WORKBENCH_STORIES.routeTree.leaves).toContain("workbench/contract/overview")
    expect(STORYBOOK_WORKBENCH_STORIES.routeTree.leaves).toContain("workbench/live/primary")
    expect(STORYBOOK_WORKBENCH_STORIES.routeTree.leaves)
      .toHaveLength(STORYBOOK_DOCUMENTATION_MODULES.length + 3)
    expect(storybookWorkbenchPresentationRoute("")).toBe("route-tree/contract/overview")
    expect(storybookWorkbenchPresentationRoute("route-tree")).toBe("route-tree/contract/overview")
    expect(storybookWorkbenchPresentationRoute("workbench/live")).toBe("workbench/live/primary")
    expect(storybookWorkbenchPresentationRoute("workbench/live/outlined")).toBe("workbench/live/outlined")
    expect(() => storybookWorkbenchPresentationRoute("missing")).toThrow("Unknown Storybook Workbench route")
  })

  test("loads and caches the real Button module only through its lazy descriptor", async () => {
    const first = STORYBOOK_WORKBENCH_STORIES.load("workbench/live/primary")
    const second = STORYBOOK_WORKBENCH_STORIES.load("workbench/live/primary")
    expect(first).toBe(second)

    const module = await first
    expect(module.controls.map(({key, kind, interactive}) => ({key, kind, interactive}))).toEqual([
      {key: "variant", kind: "select", interactive: true},
      {key: "disabled", kind: "boolean", interactive: true},
    ])
    expect(module.source(module.defaultArgs)).toContain('import {Button} from "@ui/components/button"')
    expect(module.source({...module.defaultArgs, disabled: true})).toContain("disabled: true")
  })

  test("loads every public contract as a normal Storybook story", async () => {
    const module = await STORYBOOK_WORKBENCH_STORIES.load("route-tree/contract/overview")
    expect(module.controls).toEqual([])
    expect(module.source(module.defaultArgs)).toContain('from "@zavx0z/storybook/route-tree"')

    const stories = await STORYBOOK_WORKBENCH_STORIES.load("stories/contract/overview")
    const source = stories.source(stories.defaultArgs)
    expect(source).toContain("defineStorybookStoryCatalog")
    expect(source).toContain("normalizeModule")
    expect(source).not.toContain("UiSurface")
  })
})
