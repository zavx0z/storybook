import RepoDiscoveryOwner from "@repo/discovery"
import AppServerCatalogOwner, {type AppServerCatalog as AppServerCatalogContract} from "@app-server/catalog"
const discoverStorybookPackages = RepoDiscoveryOwner
const ExternalStorybookRegistry = AppServerCatalogOwner
type ExternalStorybookRegistry = AppServerCatalogContract.Output
import {describe, expect, test} from "bun:test"
import {join} from "node:path"

const fixtureRoot = join(import.meta.dir, "../../../../repo/discovery/fixtures/valid")

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
    expect(descriptor.sourcePath).toBe(join(descriptor.packageRoot, "package.json"))
    expect(descriptor.resourceFiles?.map(file => file.sourcePath)).not.toContain(join(descriptor.packageRoot, "README.md"))
  })


})
