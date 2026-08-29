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
    expect(parseExternalStorybookCli(["detach", "project:ui"])).toEqual({action: "detach", scopeId: "project:ui"})
    expect(parseExternalStorybookCli(["open", "@ui/components", "components/button/default"])).toEqual({
      action: "open",
      packageId: "@ui/components",
      route: "components/button/default",
    })
    expect(parseExternalStorybookCli(["status"])).toEqual({action: "status"})
    expect(parseExternalStorybookCli(["check"])).toEqual({action: "check", scope: null})
    expect(parseExternalStorybookCli(["stop"])).toEqual({action: "stop"})
  })

  test("initializes declarations instead of npm packages", () => {
    expect(parseExternalStorybookCli([
      "init",
      "packages/components",
      "--kind",
      "package",
      "--executable",
      "--stories",
    ])).toEqual({
      action: "init",
      root: "packages/components",
      kind: "package",
      executable: true,
      stories: true,
    })
  })

  test("canonicalizes a running-server path scope without rewriting a package identity", () => {
    const invocationCwd = resolve(import.meta.dir, "../..")
    expect(normalizeExternalStorybookCheckScope(".", invocationCwd)).toBe(invocationCwd)
    expect(normalizeExternalStorybookCheckScope("@ui/components", invocationCwd)).toBe("@ui/components")
  })

  test("rejects old package lifecycle and malformed commands", () => {
    for (const args of [
      [],
      ["ensure", "@ui/storybook"],
      ["restart", "@ui/storybook"],
      ["build", "@ui/storybook"],
      ["attach"],
      ["init", "root", "--kind", "project", "--executable"],
    ]) expect(() => parseExternalStorybookCli(args)).toThrow("Usage")
  })
})
