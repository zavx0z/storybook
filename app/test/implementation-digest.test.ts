import {afterEach, describe, expect, test} from "bun:test"
import {existsSync, readFileSync, statSync, symlinkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join, relative, resolve} from "node:path"
import {externalStorybookImplementationDigest} from "../src/implementation-digest.ts"

const roots: string[] = []
const residentTrees = [
  "app/server", "app/mcp", "app/server/browser", "app/web/build", "app/web/protocol",
  "contracts", "package/activation", "package/artifacts", "package/build", "package/build/prepare",
  "package/documentation", "package/graph", "package/identity", "package/index",
  "package/package-json", "package/reader",
  "package/resources", "package/revision", "package/route", "package/session",
  "package/standard", "repo/discovery", "specs/scenarios/reader", "specs/reader",
  "tech/build", "tech/http", "tech/limits", "tech/process",
] as const

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("external Storybook implementation digest", () => {
  test("daemon entry stays separate from browser bundle and managing MCP source", () => {
    const root = resolve(import.meta.dir, "../..")
    const visited = new Set<string>()
    const pending = [join(root, "app/src/daemon-entry.ts")]
    while (pending.length > 0) {
      const path = pending.pop()!
      if (visited.has(path)) continue
      visited.add(path)
      const imports = new Bun.Transpiler({loader: "ts"}).scan(readFileSync(path, "utf8")).imports
      for (const entry of imports) {
        if (!entry.path.startsWith(".")) continue
        const base = resolve(dirname(path), entry.path)
        const imported = [base, `${base}.ts`, join(base, "index.ts")]
          .find(candidate => candidate.endsWith(".ts") && existsSync(candidate) && statSync(candidate).isFile())
        if (imported !== undefined) pending.push(imported)
      }
    }
    const paths = [...visited].map(path => relative(root, path))
    expect(paths, "Точка входа daemon использует собственную реализацию запуска").toContain("app/src/daemon.ts")
    expect(paths.some(path => path.startsWith("app/web/src/runtime/") || path.startsWith("workbench/") ||
      path.startsWith("app/src/mcp/"))).toBeFalse()
  })

  test("changes with resident server, package and route bytes", () => {
    const root = implementationFixture()
    const first = externalStorybookImplementationDigest(root)
    expect(first).toMatch(/^[a-f0-9]{64}$/u)
    expect(externalStorybookImplementationDigest(root)).toBe(first)
    for (const path of ["app/server/index.ts", "package/build/index.ts", "package/build/prepare/index.ts", "package/route/index.ts",
      "package/index/index.ts", "package/package-json/index.ts",
      "repo/discovery/index.ts", "specs/scenarios/reader/index.ts", "package/activation/index.ts"]) {
      const before = externalStorybookImplementationDigest(root)
      writeFileSync(join(root, path), `export const changed = ${JSON.stringify(path)}\n`)
      expect(externalStorybookImplementationDigest(root), `Resident ${path} меняет identity daemon`).not.toBe(before)
    }
  })

  test("excludes owner tests, fixtures, dependencies and browser-only code", () => {
    const root = implementationFixture()
    const first = externalStorybookImplementationDigest(root)
    for (const path of [
      "app/server/test/server.test.ts", "app/server/fixtures/owner.ts",
      "package/build/prepare/test/build.test.ts", "tech/build/inputs/spec/scenario.spec.ts",
      "app/web/src/runtime/package-entry.ts", "workbench/controller.ts",
      "app/index.ts", "app/src/mcp.ts", "app/src/stdio.ts", "tech/mcp/stdio/index.ts",
    ]) {
      mkdirSync(dirname(join(root, path)), {recursive: true})
      writeFileSync(join(root, path), "export const other = 1\n")
    }
    mkdirSync(join(root, "package/route/node_modules"), {recursive: true})
    symlinkSync(join(root, "app/server/index.ts"), join(root, "package/route/node_modules/dependency.ts"))
    expect(externalStorybookImplementationDigest(root)).toBe(first)
  })

  test("includes actual browser lifecycle, HTTP subject reader and technical inputs", () => {
    const root = implementationFixture()
    for (const path of ["app/server/browser/index.ts", "app/mcp/index.ts", "app/web/protocol/index.ts",
      "tech/build/index.ts", "tech/process/index.ts", "tech/http/index.ts"]) {
      const before = externalStorybookImplementationDigest(root)
      writeFileSync(join(root, path), `export const resident = ${JSON.stringify(path)}\n`)
      expect(externalStorybookImplementationDigest(root)).not.toBe(before)
    }
  })
})

function implementationFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "storybook-implementation-digest-"))
  roots.push(root)
  for (const tree of residentTrees) {
    mkdirSync(join(root, tree), {recursive: true})
    writeFileSync(join(root, tree, "index.ts"), `export const owner = ${JSON.stringify(tree)}\n`)
  }
  for (const path of ["bun.lock", "bunfig.toml", "package.json", "app/src/daemon-entry.ts",
    "app/src/daemon.ts", "app/src/implementation-digest.ts", "app/web/index.ts"]) {
    mkdirSync(dirname(join(root, path)), {recursive: true})
    writeFileSync(join(root, path), `source ${path}\n`)
  }
  return root
}
