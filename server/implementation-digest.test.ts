import {afterEach, describe, expect, test} from "bun:test"
import {existsSync, readFileSync, statSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join, relative, resolve} from "node:path"
import {externalStorybookImplementationDigest} from "./implementation-digest.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("external Storybook implementation digest", () => {
  test("resident import graph keeps browser-only modules outside daemon identity", () => {
    const root = resolve(import.meta.dir, "..")
    const visited = new Set<string>()
    const pending = [join(root, "scripts/storybook-daemon.ts")]
    while (pending.length > 0) {
      const path = pending.pop()!
      if (visited.has(path)) continue
      visited.add(path)
      const loader = path.endsWith(".tsx") ? "tsx" : "ts"
      const imports = new Bun.Transpiler({loader}).scan(readFileSync(path, "utf8")).imports
      for (const entry of imports) {
        if (!entry.path.startsWith(".")) continue
        const base = resolve(dirname(path), entry.path)
        const imported = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]
          .find(candidate => /\.tsx?$/u.test(candidate) && existsSync(candidate) && statSync(candidate).isFile())
        if (imported !== undefined) pending.push(imported)
      }
    }
    expect([...visited].map(path => relative(root, path))
      .filter(path => path.startsWith("runtime/") || path.startsWith("workbench/")).sort()).toEqual([
      "runtime/client-protocol.ts", "runtime/font-faces.ts", "runtime/page-title.ts",
    ])
  })

  test("is deterministic and changes with runtime implementation bytes", () => {
    const root = implementationFixture()
    const first = externalStorybookImplementationDigest(root)
    const second = externalStorybookImplementationDigest(root)
    expect(first).toMatch(/^[a-f0-9]{64}$/u)
    expect(second).toBe(first)

    writeFileSync(join(root, "server/server.ts"), "export const revision = 2\n")
    expect(externalStorybookImplementationDigest(root)).not.toBe(first)
  })

  test("excludes tests and owner fixtures from daemon identity", () => {
    const root = implementationFixture()
    const first = externalStorybookImplementationDigest(root)
    writeFileSync(join(root, "server/server.test.ts"), "test revision 2\n")
    writeFileSync(join(root, "server/fixtures/owner.ts"), "owner revision 2\n")
    expect(externalStorybookImplementationDigest(root)).toBe(first)
  })

  test("includes resident browser lifecycle but excludes browser bundles and transport adapters", () => {
    const root = implementationFixture()
    const first = externalStorybookImplementationDigest(root)
    writeFileSync(join(root, "browser-lifecycle/src/service.ts"), "browser lifecycle revision 2\n")
    expect(externalStorybookImplementationDigest(root)).not.toBe(first)
    const lifecycleRevision = externalStorybookImplementationDigest(root)
    writeFileSync(join(root, "server/controller.ts"), "controller revision 2\n")
    writeFileSync(join(root, "server/control-client.ts"), "control client revision 2\n")
    writeFileSync(join(root, "server/cli.ts"), "cli revision 2\n")
    expect(externalStorybookImplementationDigest(root)).toBe(lifecycleRevision)

    writeFileSync(join(root, "runtime/package-entry.ts"), "browser runtime revision 2\n")
    writeFileSync(join(root, "workbench/controller.ts"), "workbench revision 2\n")
    expect(externalStorybookImplementationDigest(root)).toBe(lifecycleRevision)
    writeFileSync(join(root, "runtime/client-protocol.ts"), "client protocol revision 2\n")
    expect(externalStorybookImplementationDigest(root)).not.toBe(lifecycleRevision)
  })
})

function implementationFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "storybook-implementation-digest-"))
  roots.push(root)
  for (const directory of [
    "schemas",
    "scripts",
    "workbench",
    "catalog",
    "discovery",
    "build",
    "sessions",
    "src/shared",
    "runtime",
    "server/fixtures",
    "browser-lifecycle/src",
  ]) {
    mkdirSync(join(root, directory), {recursive: true})
  }
  writeFileSync(join(root, "bun.lock"), "lock\n")
  writeFileSync(join(root, "bunfig.toml"), "[loader]\n")
  writeFileSync(join(root, "package.json"), "{}\n")
  writeFileSync(join(root, "browser-lifecycle/package.json"), "{}\n")
  writeFileSync(join(root, "scripts/storybook-daemon.ts"), "daemon\n")
  writeFileSync(join(root, "schemas/manifest.schema.json"), "{}\n")
  writeFileSync(join(root, "workbench/controller.ts"), "export const workbench = true\n")
  writeFileSync(join(root, "server/server.ts"), "export const revision = 1\n")
  writeFileSync(join(root, "server/controller.ts"), "controller revision 1\n")
  writeFileSync(join(root, "server/control-client.ts"), "control client revision 1\n")
  writeFileSync(join(root, "server/cli.ts"), "cli revision 1\n")
  writeFileSync(join(root, "browser-lifecycle/src/service.ts"), "browser lifecycle revision 1\n")
  writeFileSync(join(root, "runtime/package-entry.ts"), "browser runtime revision 1\n")
  for (const file of ["client-protocol.ts", "font-faces.ts", "page-title.ts"]) {
    writeFileSync(join(root, "runtime", file), "resident runtime revision 1\n")
  }
  writeFileSync(join(root, "server/server.test.ts"), "test revision 1\n")
  writeFileSync(join(root, "server/fixtures/owner.ts"), "owner revision 1\n")
  return root
}
