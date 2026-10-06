import {expect, test} from "bun:test"
import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createEnvironment from "@zavx0z/storybook-app-environment"

const levels = [
  {type: "Project", document: "Проектирование"},
  {type: "Repo", document: "Проектирование Repo"},
  {type: "Domain", document: "Структура Domain"},
  {type: "Cluster", document: "Структура Cluster"},
  {type: "Container", document: "Структура Container"},
  {type: "Component", document: "Размещение и ответственность Component"},
] as const

test.each([...levels])("$type: краткий старт, собственная методология по запросу и инструменты своей области", async ({type, document}) => {
  const directory = await mkdtemp(join(tmpdir(), "agent-level-"))
  await writeFile(join(directory, "own.txt"), type)
  const address = type === "Project" ? "/" : "/subject"
  const environment = createEnvironment({resolve: path => ({address: path, label: type, directory, type}), readKnowledge: async () => Response.json({path: ".", children: []})})
  try {
    const assignment = await environment.assign({executorId: `test-${type}`, address})
    const initial = assignment.bootstrap
    expect(initial.subject).toEqual({address, label: type, type})
    expect(initial.instructions).toHaveLength(2)
    expect(initial.instructions[1]!.content).toContain(`Ты специалист уровня ${type}`)
    expect(initial.instructions.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThan(2000)
    const names = initial.tools.map(tool => tool.name)
    expect(names).toContain("filesystem.read")
    expect(names.includes("git.status")).toBe(type === "Repo")
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await environment.handle(new Request("http://localhost/environment", {method: "POST", headers: {authorization: `Bearer ${assignment.token}`}, body: JSON.stringify({name, arguments: args})}))
      return {status: response.status, ...await response.json()}
    }
    const menu = await call("knowledge.read", {path: "./environment/documents"})
    const children = menu.result.children as {path: string, description: string}[]
    const item = children.find(item => item.description === document)
    expect(item).toBeDefined()
    expect(children.map(item => item.description)).not.toContain("Структура Project, Repo и пакетов")
    for (const other of levels.filter(other => other.type !== type)) {
      expect(children.map(item => item.description)).not.toContain(other.document)
    }
    const detail = await call("knowledge.read", {path: item!.path})
    expect(detail.status).toBe(200)
    expect(detail.result.content).toMatch(/^#/u)
    expect(JSON.stringify(initial)).not.toContain(detail.result.content)
    expect((await call("filesystem.read", {path: "own.txt"})).result.content).toBe(type)
    expect((await call("filesystem.read", {path: "../outside"})).error.code).toBeDefined()
  } finally { environment.dispose(); await rm(directory, {recursive: true, force: true}) }
})
