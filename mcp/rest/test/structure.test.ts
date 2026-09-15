import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import {findScenario, readChildren, resolveArchetype} from "../src/structure"

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, {recursive: true, force: true})
})

test("Новый публичный вход доступен без добавления маршрута", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "scenario-navigation-"))
  directories.push(root)
  const owner = resolve(root, "archetypes")
  const child = resolve(owner, "new-owner")
  await mkdir(child, {recursive: true})
  await Bun.write(resolve(owner, "package.json"), JSON.stringify({exports: {".": "./index.ts"}}))
  expect(await readChildren(owner)).toEqual([])
  await Bun.write(resolve(owner, "package.json"), JSON.stringify({exports: {".": "./index.ts", "./new": "./new-owner/index.ts"}}))
  expect(await resolveArchetype(root, "archetypes/new")).toBe(await realpath(child))
  expect(await resolveArchetype(root, "archetypes/../new-owner")).toBeNull()
})

test("Экспорт и сценарий не выводят запрос за пределы владельца", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "scenario-navigation-"))
  directories.push(root)
  const owner = resolve(root, "archetypes")
  await mkdir(resolve(owner, "spec"), {recursive: true})
  await mkdir(resolve(root, "outside"))
  await Bun.write(resolve(owner, "package.json"), JSON.stringify({exports: {"./outside": "../outside/index.ts"}}))
  expect(await readChildren(owner)).toEqual([])
  await Bun.write(resolve(root, "outside/scenario.spec.ts"), "")
  await symlink(resolve(root, "outside/scenario.spec.ts"), resolve(owner, "spec/scenario.spec.ts"))
  await expect(findScenario(await realpath(owner))).rejects.toThrow("перенаправлять")
})
