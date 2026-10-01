import {afterEach, describe, expect, test} from "bun:test"
import {existsSync, readFileSync, statSync, symlinkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs"
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
    const beforeRoute = externalStorybookImplementationDigest(root)
    writeFileSync(join(root, "route/index.ts"), "export const resolveRoute = () => null\n")
    expect(externalStorybookImplementationDigest(root)).not.toBe(beforeRoute)
    const beforeDocumentation = externalStorybookImplementationDigest(root)
    writeFileSync(join(root, "archetypes/package/documentation/index.ts"), "export const reader = () => null\n")
    expect(externalStorybookImplementationDigest(root)).not.toBe(beforeDocumentation)
    const beforeScenario = externalStorybookImplementationDigest(root)
    writeFileSync(join(root, "app-old/scenarios/index.ts"), "export const readScenario = () => null\n")
    expect(externalStorybookImplementationDigest(root)).not.toBe(beforeScenario)
    const beforeActivation = externalStorybookImplementationDigest(root)
    writeFileSync(join(root, "hmr/activation/index.ts"), "export default function activate() {}\n")
    expect(externalStorybookImplementationDigest(root)).not.toBe(beforeActivation)
    const afterActivation = externalStorybookImplementationDigest(root)
    writeFileSync(join(root, "hmr/page/index.ts"), "export default function page() {}\n")
    expect(externalStorybookImplementationDigest(root)).toBe(afterActivation)
    const beforeRules = externalStorybookImplementationDigest(root)
    writeFileSync(join(root, "archetypes/specs/scenarios/validation/index.ts"), "export const validateScenario = () => null\n")
    expect(externalStorybookImplementationDigest(root)).not.toBe(beforeRules)
  })

  test("excludes tests and owner fixtures from daemon identity", () => {
    const root = implementationFixture()
    const first = externalStorybookImplementationDigest(root)
    writeFileSync(join(root, "server/server.test.ts"), "test revision 2\n")
    writeFileSync(join(root, "server/fixtures/owner.ts"), "owner revision 2\n")
    mkdirSync(join(root, "route/node_modules"), {recursive: true})
    symlinkSync(join(root, "server/server.ts"), join(root, "route/node_modules/dependency.ts"))
    expect(externalStorybookImplementationDigest(root)).toBe(first)
  })

  test("fixture helpers в tech сохраняют identity daemon, production bytes меняют её", () => {
    const root = implementationFixture()
    const helpers = [
      "tech/build/inputs/test/fixture/index.ts",
      "tech/build/inputs/spec/scenario.spec.ts",
      "tech/build/inputs/spec/fixture/index.ts",
      "tech/build/inputs/fixtures/owner.ts",
      "tech/process/measure/test/fixture/helper.ts",
    ]
    const first = externalStorybookImplementationDigest(root)
    for (const path of helpers) {
      mkdirSync(dirname(join(root, path)), {recursive: true})
      writeFileSync(join(root, path), "export const fixture = 1\n")
    }
    expect(externalStorybookImplementationDigest(root)).toBe(first)
    for (const path of helpers) writeFileSync(join(root, path), "export const fixture = 2\n")
    expect(externalStorybookImplementationDigest(root)).toBe(first)

    for (const path of ["tech/build/inputs/src/core.ts", "tech/process/measure/src/core.ts"]) {
      mkdirSync(dirname(join(root, path)), {recursive: true})
      writeFileSync(join(root, path), "export const implementation = 1\n")
      const before = externalStorybookImplementationDigest(root)
      writeFileSync(join(root, path), "export const implementation = 2\n")
      expect(externalStorybookImplementationDigest(root)).not.toBe(before)
    }
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
    writeFileSync(join(root, "app-old/index.ts"), "browser app revision 2\n")
    expect(externalStorybookImplementationDigest(root)).toBe(lifecycleRevision)
    writeFileSync(join(root, "runtime/client-protocol.ts"), "client protocol revision 2\n")
    expect(externalStorybookImplementationDigest(root)).not.toBe(lifecycleRevision)
  })
})

function implementationFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "storybook-implementation-digest-"))
  roots.push(root)
  for (const directory of [
    "scripts",
    "workbench",
    "catalog",
    "discovery",
    "archetypes/package/documentation",
    "archetypes/specs/scenarios/validation",
    "app-old/scenarios",
    "app-old/spec-reader",
    "app/web",
    "route",
    "build",
    "tech/build",
    "tech/process",
    "sessions",
    "hmr/activation",
    "hmr/page",
    "runtime",
    "server/fixtures",
    "browser-lifecycle/src",
  ]) {
    mkdirSync(join(root, directory), {recursive: true})
  }
  writeFileSync(join(root, "bun.lock"), "lock\n")
  writeFileSync(join(root, "bunfig.toml"), "[loader]\n")
  writeFileSync(join(root, "package.json"), "{}\n")
  writeFileSync(join(root, "archetypes/package/package.json"), "{}\n")
  writeFileSync(join(root, "archetypes/specs/package.json"), "{}\n")
  writeFileSync(join(root, "app-old/package.json"), "{}\n")
  writeFileSync(join(root, "app/index.ts"), "export default function app() {}\n")
  writeFileSync(join(root, "app/web/index.ts"), "export default function web() {}\n")
  writeFileSync(join(root, "browser-lifecycle/package.json"), "{}\n")
  writeFileSync(join(root, "scripts/storybook-daemon.ts"), "daemon\n")
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
