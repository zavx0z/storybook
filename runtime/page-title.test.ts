import {describe, expect, test} from "bun:test"
import {externalStorybookPageTitle} from "./page-title.ts"

describe("external Storybook native page title", () => {
  test("uses MetaFor for landing and self while preserving owner package labels", () => {
    expect(externalStorybookPageTitle(null)).toBe("MetaFor")
    expect(externalStorybookPageTitle("@zavx0z/storybook", "External Storybook")).toBe("MetaFor")
    expect(externalStorybookPageTitle("@fixture/engine", "Engine")).toBe("Engine")
  })

  test("rejects an owner package without an exact label", () => {
    expect(() => externalStorybookPageTitle("@fixture/engine")).toThrow("requires a label")
    expect(() => externalStorybookPageTitle("@fixture/engine", " ")).toThrow("requires a label")
  })
})
