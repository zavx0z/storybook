import {discoverStorybookPackages} from "../discovery/packages.ts"
import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {ExternalStorybookRegistry} from "./registry.ts"
import {externalStorybookStructuralWatchPaths} from "../server/server.ts"

const fixtureRoot = join(import.meta.dir, "../discovery/fixtures/valid")
const storybookRoot = join(import.meta.dir, "..")

describe("external Storybook attached-root registry", () => {
  test("atomically attaches nested workspaces and an independent package", async () => {
    const registry = new ExternalStorybookRegistry(discoverStorybookPackages)
    await registry.attach(fixtureRoot)
    const snapshot = await registry.attach(join(fixtureRoot, "standalone"))
    expect(snapshot.entries.map(({canonicalId}) => canonicalId)).toEqual([
      "package:fixture-workspace",
      "package:@fixture/standalone",
    ])
    expect(snapshot.graph.rootIds).toEqual(snapshot.entries.map(({canonicalId}) => canonicalId))
    expect(snapshot.entries[0]?.descendantIds).toContain("package:@fixture/components")
    expect(snapshot.entries[1]?.rootKind).toBe("package")
  })

  test("keeps the current graph untouched when a new root fails validation", async () => {
    const registry = new ExternalStorybookRegistry(discoverStorybookPackages)
    const before = await registry.attach(fixtureRoot)
    await expect(registry.attach(join(fixtureRoot, "missing"))).rejects.toThrow()
    const after = registry.snapshot()
    expect(after.revision).toBe(before.revision)
    expect(after.graph).toBe(before.graph)
    expect(after.entries).toBe(before.entries)
  })

  test("detaches only the selected subtree", async () => {
    const registry = new ExternalStorybookRegistry(discoverStorybookPackages)
    await registry.attachMany([fixtureRoot, join(fixtureRoot, "standalone")])
    const detached = await registry.detach("fixture-workspace")
    expect(detached.entries.map(({canonicalId}) => canonicalId)).toEqual(["package:@fixture/standalone"])
    expect(detached.graph.nodes.some(({id}) => id === "package:@fixture/components")).toBeFalse()
    expect(detached.graph.nodes.some(({id}) => id === "package:@fixture/standalone")).toBeTrue()
  })

  test("derives independent build descriptors from structural owners", async () => {
    const registry = new ExternalStorybookRegistry(discoverStorybookPackages)
    await registry.attach(fixtureRoot)
    const descriptor = registry.packageDescriptors().find(({packageId}) => packageId === "@fixture/components")!
    expect(descriptor.projectRoot).toBe(fixtureRoot)
    expect(descriptor.packageRoot).toEndWith("/projects/alpha/packages/components")
    expect(descriptor.sourcePath).toEndWith("/projects/alpha/packages/components/package.json")
    expect(descriptor.declarationDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(descriptor.graphSnapshot.nodes.map(node => node.id)).toEqual([
      "package:@fixture/components",
      "directory:package:@fixture/components/docs",
    ])
    expect(descriptor.graphSnapshot.routes.map(route => route.path)).toEqual(["", "dir-docs"])
    expect(descriptor.watchPaths).toContainEqual({path: descriptor.sourcePath, category: "metadata"})
    expect(descriptor.watchPaths).toContainEqual({path: join(descriptor.packageRoot, "README.md"), category: "metadata"})
    const structural = externalStorybookStructuralWatchPaths(registry.snapshot())
    expect(structural).toContain(join(fixtureRoot, "package.json"))
    expect(structural).toContain(join(fixtureRoot, "projects/alpha/package.json"))
    expect(structural).toContain(descriptor.sourcePath)
  })

  test("copies and watches one Workbench theme for each package revision", async () => {
    const registry = new ExternalStorybookRegistry(discoverStorybookPackages)
    await registry.attachMany([storybookRoot, fixtureRoot])
    const descriptor = registry.packageDescriptors().find(({packageId}) => packageId === "@fixture/components")!
    expect(descriptor.graphSnapshot.workbenchAuthorStyleSheets.map(({specifier, url}) => ({specifier, url}))).toEqual([{
      specifier: "@zavx0z/ui/themes/theme.css",
      url: "workbench-author-style-sheets/0.css",
    }])
    const resource = descriptor.resourceFiles?.find(({targetPath}) => targetPath === "workbench-author-style-sheets/0.css")
    expect(resource?.contentDigest).toBe(descriptor.graphSnapshot.workbenchAuthorStyleSheets[0]!.contentDigest)
    expect(resource?.sourcePath).toEndWith("/ui/themes/theme.css")
    expect(descriptor.watchPaths).toContainEqual({path: resource!.sourcePath, category: "resource"})
  }, 20_000)
})
