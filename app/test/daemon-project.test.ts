import {afterEach, expect, test} from "bun:test"
import {mkdir, mkdtemp, realpath, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {resolveDaemonProject} from "../src/daemon"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true}))) })
const fixture = async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-daemon-project-")))
  roots.push(root)
  await mkdir(join(root, "project"))
  await mkdir(join(root, "tool"))
  return root
}

test("Явный Project независим от расположения инструмента и Git", async () => {
  const root = await fixture()
  expect(await resolveDaemonProject(join(root, "tool"), [join(root, "project")])).toBe(join(root, "project"))
  expect(await resolveDaemonProject(join(root, "tool"), [join(root, "project/package.json")])).toBe(join(root, "project"))
})

test("Несколько разных Project отклоняются", async () => {
  const root = await fixture()
  await expect(resolveDaemonProject(root, [join(root, "project"), join(root, "tool")])).rejects.toThrow("единственный Project")
})

test("Алиасы одного Project имеют одно физическое назначение", async () => {
  const root = await fixture()
  await symlink(join(root, "project"), join(root, "alias"))
  expect(await resolveDaemonProject(root, [join(root, "project"), join(root, "alias")])).toBe(join(root, "project"))
})
