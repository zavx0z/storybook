import {afterEach, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {discoverStorybookPackages} from "./packages.ts"

const roots: string[] = []
const fixtureRoot = join(import.meta.dir, "fixtures/valid")

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))
})

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-packages-")))
  roots.push(root)
  const child = join(root, "packages/child")
  await mkdir(child, {recursive: true})
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/root", label: "Root", workspaces: ["packages/*"]}))
  await writeFile(join(child, "package.json"), JSON.stringify({name: "@fixture/child", label: "Child"}))
  await writeFile(join(child, "README.md"), "# Child\n")
  return {root, child}
}

describe("structural package discovery", () => {
  test("reads nested packages and an independent root from package.json/workspaces", async () => {
    const catalog = await discoverStorybookPackages([fixtureRoot, join(fixtureRoot, "standalone")])
    expect(catalog.rootIds).toEqual(["package:fixture-workspace", "package:@fixture/standalone"])
    expect(catalog.scopes.map(scope => scope.canonicalId)).toEqual([
      "package:fixture-workspace",
      "package:fixture-alpha",
      "package:@fixture/components",
      "package:fixture-beta",
      "package:@fixture/docs",
      "package:@fixture/standalone",
    ])
    expect(catalog.scopes.every(scope => scope.kind === "package")).toBeTrue()
    const components = catalog.scopes.find(scope => scope.id === "@fixture/components")!
    expect(components.source.path).toEndWith("/package.json")
    expect(components.structurePaths).not.toContain(join(components.scopeRoot, "README.md"))
    expect(components.scopeRoot).toEndWith("/projects/alpha/packages/components")
    expect(components.digest).toMatch(/^[a-f0-9]{64}$/u)
    expect(Object.isFrozen(catalog.scopes)).toBeTrue()
  })

  test("package labels refresh from metadata and invalid updates retain the last good scope", async () => {
    const {root, child} = await fixture()
    const first = await discoverStorybookPackages([root])
    const metadata = join(child, "package.json")
    const value = JSON.parse(await readFile(metadata, "utf8"))
    await writeFile(metadata, JSON.stringify({...value, label: "Renamed"}))
    const second = await discoverStorybookPackages([root])
    expect(second.scopes.find(scope => scope.id === "@fixture/child")?.label).toBe("Renamed")
    await writeFile(metadata, "{invalid")
    await expect(discoverStorybookPackages([root])).rejects.toThrow()
    const retained = await discoverStorybookPackages([root], second)
    expect(retained.scopes.find(scope => scope.id === "@fixture/child")?.label).toBe("Renamed")
    expect(retained.scopes.find(scope => scope.id === "@fixture/child")?.resolutionError).toBeDefined()
    expect(first.scopes.find(scope => scope.id === "@fixture/child")?.label).toBe("Child")
  })

  test("ignores obsolete project configuration files", async () => {
    const {root} = await fixture()
    await mkdir(join(root, ".storybook"))
    await writeFile(join(root, ".storybook/manifest.json"), "{invalid")
    await writeFile(join(root, ".storybook/catalog.json"), "{invalid")
    const catalog = await discoverStorybookPackages([root])
    expect(catalog.rootIds).toEqual(["package:@fixture/root"])
    expect(catalog.scopes.map(scope => scope.id)).toContain("@fixture/child")
  })

  test("rejects duplicate package names across selected roots", async () => {
    const {root} = await fixture()
    const other = await realpath(await mkdtemp(join(tmpdir(), "storybook-duplicate-")))
    roots.push(other)
    await writeFile(join(other, "package.json"), JSON.stringify({name: "@fixture/root"}))
    await expect(discoverStorybookPackages([root, other])).rejects.toThrow("Duplicate package identity")
  })

  test("rejects symlink package metadata and workspace roots", async () => {
    const {root, child} = await fixture()
    const metadata = join(child, "package.json")
    const target = join(root, "copy.json")
    await writeFile(target, await readFile(metadata))
    await rm(metadata)
    await symlink(target, metadata)
    await expect(discoverStorybookPackages([root])).rejects.toThrow("exact file")
    await rm(metadata)
    await writeFile(metadata, JSON.stringify({name: "@fixture/child"}))
    const link = join(root, "packages/linked")
    await symlink(child, link)
    await expect(discoverStorybookPackages([root])).rejects.toThrow("symlink")
  })

  test("invalid root module source retains the last verified documentation", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-package-source-")))
    roots.push(root)
    await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/source"}))
    const entry = join(root, "index.ts")
    await writeFile(entry, "/**\nПроверенное описание\n@packageDocumentation\n*/")
    const first = await discoverStorybookPackages([root])
    expect(first.scopes[0]?.moduleDocumentation?.markdown).toBe("Проверенное описание")
    await writeFile(entry, "x".repeat(1_048_577))
    await expect(discoverStorybookPackages([root])).rejects.toThrow("exceeds limit")
    const retained = await discoverStorybookPackages([root], first, {dirtyScopeRoots: [root]})
    expect(retained.scopes[0]?.moduleDocumentation?.markdown).toBe("Проверенное описание")
    expect(retained.scopes[0]?.resolutionError).toContain("exceeds limit")
  })
})
