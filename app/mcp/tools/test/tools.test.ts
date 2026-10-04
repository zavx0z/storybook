import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {spawnSync} from "node:child_process"
import createTools from "@zavx0z/storybook-app-mcp-tools"
import component from "@zavx0z/storybook-component-mcp"
import createWorkspace from "@zavx0z/ai-workspace"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true}) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "entity-tools-"))
  roots.push(root)
  await mkdir(join(root, "a"))
  await mkdir(join(root, "b"))
  return root
}

test("общий набор типов и расширение Repo связаны с назначенной областью", async () => {
  const directory = await fixture()
  expect(spawnSync("git", ["init", "-q", directory]).status).toBe(0)
  for (const type of ["Project", "Component", "Container", "Cluster", "Domain"] as const) {
    const tools = createTools({directory, type})
    expect(tools.list()).toHaveLength(10)
    expect(tools.list().every(tool => tool.name.startsWith("filesystem."))).toBeTrue()
    await expect(tools.call({name: "git.status", arguments: {}})).rejects.toMatchObject({code: "UNKNOWN_TOOL"})
  }
  const repo = createTools({directory, type: "Repo"})
  expect(repo.list()).toHaveLength(11)
  expect(await repo.call({name: "git.status", arguments: {}})).toHaveProperty("branch")
  expect(createTools({directory}).list()).toHaveLength(10)
})

test("чтение, запись, patch и конфликт сохраняют контракты AI и изоляцию областей", async () => {
  const root = await fixture()
  const a = createTools({directory: join(root, "a"), type: "Component"})
  const b = createTools({directory: join(root, "b"), type: "Component"})
  await a.call({name: "filesystem.create", arguments: {path: "file.txt", content: "alpha\n"}})
  await b.call({name: "filesystem.create", arguments: {path: "file.txt", content: "beta\n"}})
  const before = await a.call({name: "filesystem.read", arguments: {path: "file.txt"}})
  expect(before.content).toBe("alpha\n")
  expect((await b.call({name: "filesystem.read", arguments: {path: "file.txt"}})).content).toBe("beta\n")
  await a.call({name: "filesystem.write", arguments: {path: "file.txt", content: "changed\n", expectedHash: before.contentHash}})
  await expect(a.call({name: "filesystem.write", arguments: {path: "file.txt", content: "lost", expectedHash: before.contentHash}}))
    .rejects.toMatchObject({code: "CONFLICT"})
  const patch = "*** Begin Patch\n*** Update File: file.txt\n@@\n-changed\n+patched\n*** End Patch"
  expect(await a.call({name: "filesystem.apply-patch", arguments: {patch}})).toMatchObject({applied: true})
  expect(await readFile(join(root, "a/file.txt"), "utf8")).toBe("patched\n")
  expect(await readFile(join(root, "b/file.txt"), "utf8")).toBe("beta\n")
  for (const args of [{path: "../b/file.txt"}, {path: join(root, "b/file.txt")}, {path: "file.txt", root: join(root, "b")}]) {
    await expect(a.call({name: "filesystem.read", arguments: args})).rejects.toHaveProperty("code")
  }
  await symlink(join(root, "b"), join(root, "a/link"))
  await expect(a.call({name: "filesystem.read", arguments: {path: "link/file.txt"}})).rejects.toMatchObject({code: "PATH_NOT_ALLOWED"})
})

test("сущность расширяет набор без копирования и не заменяет одноимённый инструмент", async () => {
  const root = await fixture()
  const workspace = createWorkspace({directory: root})
  const extra = {name: "component.example", description: "Пример расширения", inputSchema: {type: "object"},
    outputSchema: {type: "object"}, annotations: {readOnlyHint: true, destructiveHint: false}, execute: () => ({value: 42})}
  const tools = component.tools({workspace, extensions: [extra]})
  expect(tools).toHaveLength(11)
  expect(await tools.find(tool => tool.name === extra.name)!.execute({})).toEqual({value: 42})
  expect(() => component.tools({workspace, extensions: [{...extra, name: "filesystem.read"}]})).toThrow("Повтор имени")
})

test("отмена до вызова не изменяет файл; замена корня не переназначает область", async () => {
  const root = await fixture()
  const directory = join(root, "a")
  const tools = createTools({directory})
  const controller = new AbortController()
  controller.abort()
  await expect(tools.call({name: "filesystem.create", arguments: {path: "cancelled", content: "x"}}, controller.signal)).rejects.toThrow()
  expect(await Bun.file(join(directory, "cancelled")).exists()).toBeFalse()
  await rm(directory, {recursive: true})
  await symlink(join(root, "b"), directory)
  await writeFile(join(root, "b/secret"), "other")
  await expect(tools.call({name: "filesystem.read", arguments: {path: "secret"}})).rejects.toMatchObject({code: "ROOT_NOT_ALLOWED"})
})
