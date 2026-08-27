import {describe, expect, test} from "bun:test"
import {createDocument, Node} from "@zavx0z/dom"
import {STORYBOOK_DOCUMENTATION_MODULES} from "../contracts/examples.ts"
import {
  STORYBOOK_DOCUMENTATION_CATALOG,
  storybookDocumentationContext,
} from "./catalog.ts"

describe("self-documenting DOM catalog", () => {
  test("owns one contract leaf for every public module and explicit DOM Workbench variants", () => {
    expect(STORYBOOK_DOCUMENTATION_CATALOG.routeTree.leaves)
      .toContain("route-tree/contract/overview")
    expect(STORYBOOK_DOCUMENTATION_CATALOG.routeTree.leaves)
      .toContain("workbench/live/primary")
    expect(STORYBOOK_DOCUMENTATION_CATALOG.routeTree.leaves)
      .toHaveLength(STORYBOOK_DOCUMENTATION_MODULES.length + 3)
    expect(storybookDocumentationContext("")).not.toBeNull()
    expect(storybookDocumentationContext("workbench")?.componentId).toBe("workbench")
    expect(storybookDocumentationContext("missing")).toBeNull()
  })

  test("loads and caches exact DOM stories with one realm and stable roots", async () => {
    const first = STORYBOOK_DOCUMENTATION_CATALOG.load("workbench/live/primary")
    const second = STORYBOOK_DOCUMENTATION_CATALOG.load("workbench/live/primary")
    expect(first).toBe(second)
    const story = await first
    const document = createDocument()
    const args = {...story.defaultArgs}
    const root = story.render(document, args, null)
    expect(root).toBeInstanceOf(Node)
    expect(story.render(document, args, root)).toBe(root)
    expect(story.source(args).typescript).toContain('document.createElement("button")')
    expect(story.source(args).typescript).not.toContain("UiSurface")
  })

  test("loads every public contract as semantic DOM documentation", async () => {
    const story = await STORYBOOK_DOCUMENTATION_CATALOG.load("route-tree/contract/overview")
    const document = createDocument()
    const root = story.render(document, story.defaultArgs, null)
    expect(root.nodeName).toBe("ARTICLE")
    expect(root.textContent).toContain("Маршруты")
    expect(story.source(story.defaultArgs).typescript)
      .toContain('from "@zavx0z/storybook/route-tree"')
  })
})
