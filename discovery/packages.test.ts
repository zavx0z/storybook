import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, rm, symlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {discoverStorybookPackages} from "./packages"
import {createExternalStorybookGraph} from "../catalog/graph"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true}) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "storybook-structure-"))
  roots.push(root)
  await writeFile(join(root, "package.json"), JSON.stringify({name: "structure", workspaces: ["packages/*"]}))
  await mkdir(join(root, "packages/child/module/src"), {recursive: true})
  await writeFile(join(root, "packages/child/package.json"), JSON.stringify({name: "@structure/child", description: "Дочерний пакет"}))
  await writeFile(join(root, "packages/child/module/index.ts"), "/** Описание модуля. @packageDocumentation */\nexport function value() { return 1 }\n")
  await mkdir(join(root, ".storybook"))
  await writeFile(join(root, ".storybook/manifest.json"), "not a configuration")
  await writeFile(join(root, ".storybook/catalog.json"), JSON.stringify({categories: [{id: "ghost", label: "Призрак"}]}))
  return root
}

test("Обнаружение использует только package.json, workspaces и реальные директории", async () => {
  const root = await fixture()
  const catalog = await discoverStorybookPackages([root])
  const graph = createExternalStorybookGraph(catalog)
  expect(catalog.scopes.map(scope => scope.id)).toEqual(["structure", "@structure/child"])
  expect(graph.nodes.every(node => ["package", "directory", "unavailable"].includes(node.kind))).toBeTrue()
  expect(graph.nodes.some(node => node.label === "Призрак")).toBeFalse()
  expect(graph.nodes.find(node => node.id === "package:@structure/child")?.parentId).toBe("directory:package:structure/packages")
  expect(graph.nodes.find(node => node.label === "module")?.urlPath).toBe("/structure/packages/child/module")
  expect(catalog.scopes[1]?.description).toBe("Дочерний пакет")
  await expect(discoverStorybookPackages([join(root, ".storybook/manifest.json")])).rejects.toThrow()
})

test("Ошибка обновления одного пакета сохраняет его рабочую структуру", async () => {
  const root = await fixture()
  const previous = await discoverStorybookPackages([root])
  await writeFile(join(root, "packages/child/package.json"), "{")
  const next = await discoverStorybookPackages([root], previous)
  expect(next.scopes.find(scope => scope.id === "structure")?.resolutionError).toBeUndefined()
  const child = next.scopes.find(scope => scope.id === "@structure/child")!
  expect(child.resolutionError).toBeString()
  expect(child.directories).toEqual(previous.scopes[1]?.directories)
})

test("Удаление вложенного package.json открывает освободившуюся директорию при warm refresh", async () => {
  const root = await fixture()
  const previous = await discoverStorybookPackages([root])
  await rm(join(root, "packages/child/package.json"))
  const next = await discoverStorybookPackages([root], previous, {dirtyScopeRoots: [join(root, "packages/child")]})
  const graph = createExternalStorybookGraph(next)
  expect(graph.nodes.some(node => node.id === "package:@structure/child")).toBeFalse()
  expect(graph.nodes.some(node => node.id === "directory:package:structure/packages/child")).toBeTrue()
})

test("Неудачное обновление имени не резервирует чужую package identity", async () => {
  const root = await fixture()
  await mkdir(join(root, "packages/sibling"))
  await writeFile(join(root, "packages/sibling/package.json"), JSON.stringify({name: "@structure/sibling"}))
  const previous = await discoverStorybookPackages([root])
  await writeFile(join(root, "packages/child/package.json"), JSON.stringify({name: "@structure/sibling", workspaces: "invalid"}))
  const next = await discoverStorybookPackages([root], previous)
  expect(next.scopes.find(scope => scope.id === "@structure/child")?.resolutionError).toBeString()
  expect(next.scopes.find(scope => scope.id === "@structure/sibling")?.resolutionError).toBeUndefined()
})

test("Вложенный пакет сохраняет физические директории предков после модульного index", async () => {
  const root = await mkdtemp(join(tmpdir(), "storybook-structure-"))
  roots.push(root)
  await writeFile(join(root, "package.json"), JSON.stringify({name: "structure", workspaces: ["module/packages/*"]}))
  await mkdir(join(root, "module/packages/child"), {recursive: true})
  await writeFile(join(root, "module/index.ts"), "/** Модуль. @packageDocumentation */\nexport const value = 1\n")
  await writeFile(join(root, "module/packages/child/package.json"), JSON.stringify({name: "@structure/child"}))
  const graph = createExternalStorybookGraph(await discoverStorybookPackages([root]))
  expect(graph.nodes.find(node => node.id === "package:@structure/child")?.parentId).toBe("directory:package:structure/module/packages")
})

test("Symlink вместо точного package root отклоняется", async () => {
  const root = await fixture()
  await symlink(join(root, "packages/child"), join(root, "packages/linked"))
  await expect(discoverStorybookPackages([join(root, "packages/linked")])).rejects.toThrow("exact directory")
})
