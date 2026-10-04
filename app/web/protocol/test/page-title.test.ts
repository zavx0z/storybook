import {describe, expect, test} from "bun:test"
import WebProtocol from "@storybook-app-web/protocol"

describe("external Storybook native page title", () => {
  test("uses selected labels consistently including the self package", () => {
    expect(WebProtocol.pageTitle(null)).toBe("Storybook")
    expect(WebProtocol.pageTitle("@zavx0z/storybook", "External Storybook")).toBe("External Storybook")
    expect(WebProtocol.pageTitle("@fixture/engine", "Engine")).toBe("Engine")
  })

  test("rejects an owner package without an exact label", () => {
    expect(() => WebProtocol.pageTitle("@fixture/engine")).toThrow("requires a label")
    expect(() => WebProtocol.pageTitle("@fixture/engine", " ")).toThrow("requires a label")
  })
})
