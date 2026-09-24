import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rename, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {discoverStorybookPackages} from "./packages.ts"
import {ExternalStorybookRegistry} from "../catalog/registry.ts"

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
  const registry = new ExternalStorybookRegistry(discoverStorybookPackages)
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
  const after = await new ExternalStorybookRegistry(discoverStorybookPackages).configure([renamed])
  expect(after.graph.rootIds).toEqual(first.graph.rootIds)
  expect(after.graph.nodes.map(node => [node.id, node.urlPath])).toEqual(first.graph.nodes.map(node => [node.id, node.urlPath]))
})

test("same names in separate selected roots are rejected instead of receiving another identity", async () => {
  const {root, owner} = await fixture()
  const other = join(root, "other")
  await Bun.write(join(other, "package.json"), JSON.stringify({name: "@fixture/root", label: "Other"}))
  await expect(discoverStorybookPackages([owner, other])).rejects.toThrow("Duplicate package identity")
})
