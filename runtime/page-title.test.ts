import {describe, expect, test} from "bun:test"
import {externalStorybookPageTitle} from "./page-title.ts"

describe("external Storybook native page title", () => {
  test("uses selected labels consistently including the self package", () => {
    expect(externalStorybookPageTitle(null)).toBe("Storybook")
    expect(externalStorybookPageTitle("@zavx0z/storybook", "External Storybook")).toBe("External Storybook")
    expect(externalStorybookPageTitle("@fixture/engine", "Engine")).toBe("Engine")
  })

  test("rejects an owner package without an exact label", () => {
    expect(() => externalStorybookPageTitle("@fixture/engine")).toThrow("requires a label")
    expect(() => externalStorybookPageTitle("@fixture/engine", " ")).toThrow("requires a label")
  })
})
