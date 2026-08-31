import {describe, expect, test} from "bun:test"
import {externalStorybookPageTitle} from "./page-title.ts"

describe("external Storybook native page title", () => {
  test("uses MetaFor for landing and self while preserving owner package labels", () => {
    expect(externalStorybookPageTitle(null)).toBe("MetaFor")
    expect(externalStorybookPageTitle("@zavx0z/storybook", "External Storybook")).toBe("MetaFor")
    expect(externalStorybookPageTitle("@engine/core", "Engine Core")).toBe("Engine Core")
  })

  test("rejects an owner package without an exact label", () => {
    expect(() => externalStorybookPageTitle("@engine/core")).toThrow("requires a label")
    expect(() => externalStorybookPageTitle("@engine/core", " ")).toThrow("requires a label")
  })
})
