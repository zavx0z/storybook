import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {discoverStorybookDirectories} from "./directories.ts"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})))
})

test("finds ordinary and empty directories, skips src and keeps packages as separate owners", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-directories-")))
  roots.push(root)
  expect(await Bun.spawn(["git", "init", "--quiet", root]).exited).toBe(0)
  await Bun.write(join(root, ".gitignore"), "node_modules/\n")
  for (const path of ["docs/guide", "docs/src/private", "empty", "src/hidden", "packages/tool/stories", "node_modules/dependency", "build", ".storybook/stories", "tests/unit", "test/unit", "docs/.storybook/stories", "docs/tests/unit", "docs/test/unit"]) {
    await mkdir(join(root, path), {recursive: true})
  }
  await Bun.write(join(root, "docs/README.md"), "# Documentation")
  await symlink(join(root, "docs"), join(root, "linked"))
  const result = await discoverStorybookDirectories(root, new Set([join(root, "packages/tool")]))
  expect(result.directories.map(directory => directory.name)).toEqual(["build", "docs", "empty", "packages"])
  const docs = result.directories.find(directory => directory.name === "docs")!
  expect(docs.readmePath).toBe(join(root, "docs/README.md"))
  expect(docs.children.map(directory => directory.relativePath)).toEqual(["docs/guide"])
  expect(result.directories.find(directory => directory.name === "packages")!.children).toEqual([])
  expect(result.watchPaths).toContain(join(root, "empty"))
  expect(result.watchPaths).not.toContain(join(root, "packages/tool"))
})

test("uses Git ignore precedence, negation, nested files and ignored tracked directories", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-gitignore-")))
  roots.push(root)
  expect(await Bun.spawn(["git", "init", "--quiet", root]).exited).toBe(0)
  for (const path of ["docs/guide/private", "docs/guide/public", "docs/draft", "tracked-cache", "build", "dist", "visible space"]) {
    await mkdir(join(root, path), {recursive: true})
  }
  await Bun.write(join(root, "tracked-cache/file.txt"), "tracked")
  expect(await Bun.spawn(["git", "-C", root, "add", "tracked-cache/file.txt"]).exited).toBe(0)
  await Bun.write(join(root, ".gitignore"), "dist/\ntracked-cache/\ndocs/*\n!docs/guide/\n")
  await Bun.write(join(root, "docs/guide/.gitignore"), "private/\n")
  const result = await discoverStorybookDirectories(root, new Set())
  expect(result.directories.map(directory => directory.name)).toEqual(["build", "docs", "visible space"])
  const docs = result.directories.find(directory => directory.name === "docs")!
  expect(docs.children.map(directory => directory.name)).toEqual(["guide"])
  expect(docs.children[0]!.children.map(directory => directory.name)).toEqual(["public"])
  expect(result.watchPaths).toContain(join(root, "docs/guide/.gitignore"))
  expect((await discoverStorybookDirectories(join(root, "docs/guide"), new Set())).directories.map(directory => directory.name)).toEqual(["public"])
  await Bun.write(join(root, "docs/guide/.gitignore"), "public/\n")
  expect((await discoverStorybookDirectories(join(root, "docs/guide"), new Set())).directories.map(directory => directory.name)).toEqual(["private"])
})
