import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rename, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {resolveExternalStorybookDeclarations} from "./declarations.ts"
import {ExternalStorybookRegistry} from "../catalog/registry.ts"
import {StorybookPackageUrlMigrations} from "../server/package-url-migrations.ts"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true}))) })

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-package-identity-")))
  roots.push(root)
  const owner = join(root, "arbitrary-folder")
  await mkdir(owner)
  await Bun.write(join(owner, "package.json"), JSON.stringify({name: "@fixture/root", label: "Root", workspaces: ["packages/**"]}))
  await Bun.write(join(owner, "packages/a/package.json"), JSON.stringify({name: "@fixture/a", label: "A", workspaces: ["child"]}))
  await Bun.write(join(owner, "packages/a/child/package.json"), JSON.stringify({name: "@fixture/child", label: "Child"}))
  await Bun.write(join(owner, "README.md"), "# Root documentation")
  return {root, owner}
}

test("root identity comes from package name and nested workspaces produce one owner each", async () => {
  const {root, owner} = await fixture()
  const registry = new ExternalStorybookRegistry(resolveExternalStorybookDeclarations)
  const first = await registry.configure([owner])
  expect(first.graph.rootIds).toEqual(["package:@fixture/root"])
  expect(first.catalog.scopes.every(scope => scope.kind === "package")).toBeTrue()
  expect(first.catalog.scopes.map(scope => scope.id).sort()).toEqual(["@fixture/a", "@fixture/child", "@fixture/root"])
  expect(first.graph.nodes.find(node => node.packageId === "@fixture/child")?.parentId).toBe("package:@fixture/a")
  for (const descriptor of registry.packageDescriptors()) {
    expect(descriptor.graphSnapshot.nodes.every(node => node.packageId === descriptor.packageId)).toBeTrue()
    expect(descriptor.projectRoot).toBe(owner)
  }
  const renamed = join(root, "renamed-folder")
  await rename(owner, renamed)
  const after = await new ExternalStorybookRegistry(resolveExternalStorybookDeclarations).configure([renamed])
  expect(after.graph.rootIds).toEqual(first.graph.rootIds)
  expect(after.graph.nodes.map(node => [node.id, node.urlPath])).toEqual(first.graph.nodes.map(node => [node.id, node.urlPath]))
})

test("legacy composition identity is ignored and former URLs survive declaration removal", async () => {
  const {root, owner} = await fixture()
  const manifest = join(owner, ".storybook/manifest.json")
  await Bun.write(manifest, JSON.stringify({schemaVersion: 1, kind: "project", id: "former-project"}))
  const registry = new ExternalStorybookRegistry(resolveExternalStorybookDeclarations)
  const before = await registry.configure([owner])
  expect(before.graph.rootIds).toEqual(["package:@fixture/root"])
  const historyPath = join(root, "url-history.json")
  new StorybookPackageUrlMigrations(historyPath).remember(before.catalog)
  await rm(manifest)
  const after = await registry.refresh()
  expect(after.graph.rootIds).toEqual(before.graph.rootIds)
  const history = new StorybookPackageUrlMigrations(historyPath)
  expect(history.resolve("/projects/former-project/", after.graph)).toBe("/pkg-fixture-root/")
  expect(history.resolve("/projects/unknown/", after.graph)).toBeNull()
  expect(history.resolve("/projects/former-project/", {schemaVersion: 1, rootIds: [], nodes: [], digest: "empty"})).toBeNull()
})

test("same names in separate selected roots are rejected instead of receiving another identity", async () => {
  const {root, owner} = await fixture()
  const other = join(root, "other")
  await Bun.write(join(other, "package.json"), JSON.stringify({name: "@fixture/root", label: "Other"}))
  await expect(resolveExternalStorybookDeclarations([owner, other])).rejects.toThrow("Ambiguous")
})
