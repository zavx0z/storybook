import {describe, expect, test} from "bun:test"

describe("Storybook documentation Pages cold bootstrap", () => {
  test("pins every peer owner before the frozen self install and check", async () => {
    const workflow = await Bun.file(new URL("../.github/workflows/pages.yml", import.meta.url)).text()
    for (const [repository, revision] of [
      ["zavx0z/engine", "ae461b8ab622d391247c714f3937f18bd5b4ae45"],
      ["zavx0z/layout", "c97bc83b935ae1299c3db304c35483bb30f6de80"],
      ["zavx0z/ui", "74f5e7a8d3defb06787b6975dd672f5c1cba89fc"],
      ["zavx0z/highlighter", "a9f240b682a6ccec042ea04522220f153d3b53eb"],
    ] as const) {
      expect(workflow).toContain(`repository: ${repository}\n          ref: ${revision}`)
    }

    const bootstrap = [
      "name: Register Engine package",
      "name: Register Layout package",
      "name: Register UI Elements package",
      "name: Register UI Components package",
      "name: Install and verify Highlighter dependency",
      "name: Register Highlighter package",
      "name: Install Storybook dependencies",
      "name: Verify and build Storybook documentation",
      "name: Configure Pages",
      "name: Upload Storybook documentation artifact",
    ].map((marker) => workflow.indexOf(marker))
    expect(bootstrap.every((position) => position >= 0)).toBeTrue()
    expect(bootstrap).toEqual([...bootstrap].sort((left, right) => left - right))
    expect(workflow).toContain("working-directory: storybook\n        run: bun install --frozen-lockfile")
    expect(workflow).toContain("working-directory: storybook\n        run: bun run check")
    expect(workflow).toContain("path: storybook/dist")
  })
})
