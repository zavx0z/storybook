import {afterEach, expect, test} from "bun:test"
import {cp, mkdtemp, rm, mkdir, writeFile, readFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import createEnvironment from "@zavx0z/storybook-app-environment"
import createTools from "@zavx0z/storybook-app-environment-tools"

const roots: string[] = []
const cleanups: (() => void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true})
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "env-delivery-"))
  roots.push(directory)
  await cp(resolve(import.meta.dir, "../../../package/env/spec/fixture/extended"), directory, {recursive: true})
  return directory
}

test("исполнитель получает локальные правила и тулы из одной декларации; документ читается отдельно", async () => {
  const directory = await fixture()
  const env = createEnvironment({resolve: address => ({address, label: "Пример", directory, type: "Component"}), readKnowledge: async () => Response.json({path: ".", children: []})})
  cleanups.push(() => env.dispose())
  const assignment = await env.assign({executorId: "own", address: "/example"})
  expect(assignment.bootstrap.instructions).toContainEqual({source: ".agent/rules/development.md", content: "# Правило примера\n\nИзменения относятся к собственному пакету.\n", contentHash: expect.any(String)})
  expect(assignment.bootstrap.tools.map(tool => tool.name)).toContain("example.summary")
  expect(JSON.stringify(assignment.bootstrap)).not.toContain("# Единая структура")
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await env.handle(new Request("http://localhost/environment", {method: "POST", headers: {authorization: `Bearer ${assignment.token}`}, body: JSON.stringify({name, arguments: args})}))
    expect(response.status).toBe(200)
    return (await response.json()).result
  }
  expect(await call("example.summary", {})).toEqual({summary: "Локальный инструмент"})
  const menu = await call("knowledge.read", {path: "./environment/documents"})
  expect(menu.children).toContainEqual({path: `./environment/documents/${encodeURIComponent("Структура Project, Repo и пакетов")}`, description: "Структура Project, Repo и пакетов"})
  expect((await call("knowledge.read", {path: `./environment/documents/${encodeURIComponent("Структура Project, Repo и пакетов")}`})).content).toContain("# Единая структура")
})

test("назначение и чтение описания не исполняют модуль; первый вызов исполняет его", async () => {
  const directory = await fixture()
  const marker = join(directory, "loaded.txt")
  await writeFile(join(directory, ".agent/tools/example.summary/index.ts"), `import {writeFileSync} from "node:fs"\nwriteFileSync(${JSON.stringify(marker)}, "loaded")\nexport default () => ({loaded: true})`)
  const tools = createTools({directory})
  expect(tools.list().some(tool => tool.name === "example.summary")).toBeTrue()
  expect(await Bun.file(marker).exists()).toBeFalse()
  expect(await tools.call({name: "example.summary", arguments: {}})).toEqual({loaded: true})
  expect(await readFile(marker, "utf8")).toBe("loaded")
})

test("назначение ребёнка не получает инструмент родителя", async () => {
  const directory = await fixture()
  const child = join(directory, "child")
  await mkdir(child)
  const tools = createTools({directory: child})
  await expect(tools.call({name: "example.summary", arguments: {}})).rejects.toMatchObject({code: "UNKNOWN_TOOL"})
})
