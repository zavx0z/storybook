import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {discoverWorkspacePackages} from "./workspaces.ts"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))
})

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-workspaces-")))
  roots.push(root)
  for (const path of ["plain", "packages/z", "packages/a", "packages/group/nested", "packages/excluded", "packages/node_modules/dependency"]) {
    await mkdir(join(root, path), {recursive: true})
    await Bun.write(join(root, path, "package.json"), JSON.stringify({name: path.replaceAll("/", "-")}))
  }
  return root
}

test("expands exact paths, stars and recursive globs in stable order with exclusions and deduplication", async () => {
  const root = await fixture()
  const result = await discoverWorkspacePackages(root, ["plain", "packages/*", "packages/**", "!packages/excluded/**"])
  expect(result.roots).toEqual(["plain", "packages/a", "packages/z", "packages/group/nested"].map(path => join(root, path)))
  expect(result.watchPaths).toContain(join(root, "packages/group"))
  expect(result.watchPaths).toContain(join(root, "packages/group/package.json"))
  expect((await discoverWorkspacePackages(root, [])).roots).toEqual([])
  expect((await discoverWorkspacePackages(root, ["packages/{a,z}"])).roots).toEqual(["packages/a", "packages/z"].map(path => join(root, path)))
})

test("watches partial nested matches before the final directory exists", async () => {
  const root = await fixture()
  const result = await discoverWorkspacePackages(root, ["packages/*/modules/*"])
  expect(result.roots).toEqual([])
  expect(result.watchPaths).toContain(join(root, "packages/a"))
})

test("rejects escaping patterns and symlink packages", async () => {
  const root = await fixture()
  for (const patterns of [["../*"], ["/tmp/*"], ["{../*,plain}"], ["."]]) {
    await expect(discoverWorkspacePackages(root, patterns)).rejects.toThrow("inside the project")
  }
  await symlink(join(root, "plain"), join(root, "linked"))
  await expect(discoverWorkspacePackages(root, ["linked"])).rejects.toThrow("symlink")
})
