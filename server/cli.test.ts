import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {normalizeExternalStorybookCheckScope, parseExternalStorybookCli} from "./cli.ts"

describe("external Storybook CLI", () => {
  test("parses the one-server command surface", () => {
    expect(parseExternalStorybookCli(["serve", "workspace", "package"])).toEqual({
      action: "serve",
      declarations: ["workspace", "package"],
    })
    expect(parseExternalStorybookCli(["attach", "project"])).toEqual({action: "attach", path: "project"})
    expect(parseExternalStorybookCli(["detach", "@fixture/ui"])).toEqual({action: "detach", scopeId: "@fixture/ui"})
    expect(parseExternalStorybookCli(["open", "@fixture/components", "dir-button"])).toEqual({
      action: "open",
      packageId: "@fixture/components",
      route: "dir-button",
    })
    expect(parseExternalStorybookCli(["status"])).toEqual({action: "status"})
    expect(parseExternalStorybookCli(["check"])).toEqual({action: "check", scope: null})
    expect(parseExternalStorybookCli(["stop"])).toEqual({action: "stop"})
  })

  test("canonicalizes a running-server path scope without rewriting a package identity", () => {
    const invocationCwd = resolve(import.meta.dir, "..")
    expect(normalizeExternalStorybookCheckScope(".", invocationCwd)).toBe(invocationCwd)
    expect(normalizeExternalStorybookCheckScope("@fixture/components", invocationCwd))
      .toBe("@fixture/components")
  })

  test("rejects old package lifecycle and malformed commands", () => {
    for (const args of [
      [],
      ["ensure", "@ui/storybook"],
      ["restart", "@ui/storybook"],
      ["build", "@ui/storybook"],
      ["attach"],
      ["init", "root"],
    ]) expect(() => parseExternalStorybookCli(args)).toThrow("Usage")
  })
})
