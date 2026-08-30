import {afterEach, describe, expect, test} from "bun:test"
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {externalStorybookImplementationDigest} from "./implementation-digest.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("external Storybook implementation digest", () => {
  test("is deterministic and changes with runtime implementation bytes", () => {
    const root = implementationFixture()
    const first = externalStorybookImplementationDigest(root)
    const second = externalStorybookImplementationDigest(root)
    expect(first).toMatch(/^[a-f0-9]{64}$/u)
    expect(second).toBe(first)

    writeFileSync(join(root, "src/external/server.ts"), "export const revision = 2\n")
    expect(externalStorybookImplementationDigest(root)).not.toBe(first)
  })

  test("excludes tests and owner fixtures from daemon identity", () => {
    const root = implementationFixture()
    const first = externalStorybookImplementationDigest(root)
    writeFileSync(join(root, "src/external/server.test.ts"), "test revision 2\n")
    writeFileSync(join(root, "src/external/fixtures/owner.ts"), "owner revision 2\n")
    expect(externalStorybookImplementationDigest(root)).toBe(first)
  })

  test("excludes MCP-side browser mechanics but includes browser runtime", () => {
    const root = implementationFixture()
    const first = externalStorybookImplementationDigest(root)
    writeFileSync(join(root, "src/external/browser-control/client.ts"), "browser control revision 2\n")
    writeFileSync(join(root, "src/external/controller.ts"), "controller revision 2\n")
    writeFileSync(join(root, "src/external/control-client.ts"), "control client revision 2\n")
    writeFileSync(join(root, "src/external/cli.ts"), "cli revision 2\n")
    expect(externalStorybookImplementationDigest(root)).toBe(first)

    writeFileSync(join(root, "src/external/browser/package-entry.ts"), "browser runtime revision 2\n")
    expect(externalStorybookImplementationDigest(root)).not.toBe(first)
  })
})

function implementationFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "storybook-implementation-digest-"))
  roots.push(root)
  for (const directory of [
    "schemas",
    "scripts",
    "src/workbench",
    "src/external/browser",
    "src/external/browser-control",
    "src/external/fixtures",
  ]) {
    mkdirSync(join(root, directory), {recursive: true})
  }
  writeFileSync(join(root, "bun.lock"), "lock\n")
  writeFileSync(join(root, "bunfig.toml"), "[loader]\n")
  writeFileSync(join(root, "package.json"), "{}\n")
  writeFileSync(join(root, "scripts/storybook-daemon.ts"), "daemon\n")
  writeFileSync(join(root, "schemas/manifest.schema.json"), "{}\n")
  writeFileSync(join(root, "src/workbench/controller.ts"), "export const workbench = true\n")
  writeFileSync(join(root, "src/external/server.ts"), "export const revision = 1\n")
  writeFileSync(join(root, "src/external/controller.ts"), "controller revision 1\n")
  writeFileSync(join(root, "src/external/control-client.ts"), "control client revision 1\n")
  writeFileSync(join(root, "src/external/cli.ts"), "cli revision 1\n")
  writeFileSync(join(root, "src/external/browser-control/client.ts"), "browser control revision 1\n")
  writeFileSync(join(root, "src/external/browser/package-entry.ts"), "browser runtime revision 1\n")
  writeFileSync(join(root, "src/external/server.test.ts"), "test revision 1\n")
  writeFileSync(join(root, "src/external/fixtures/owner.ts"), "owner revision 1\n")
  return root
}
