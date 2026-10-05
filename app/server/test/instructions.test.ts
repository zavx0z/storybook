import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, readdir, rm, symlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createInstructionsReader from "../src/instructions"
import createServerEnvironment from "../src/environment"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"

const cleanups: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture() {
  const project = await mkdtemp(join(tmpdir(), "agent-rules-"))
  cleanups.push(() => rm(project, {recursive: true, force: true}))
  const directory = join(project, "repo/package")
  await mkdir(directory, {recursive: true})
  const write = async (source: string, content: string) => {
    const segments = source.split("/")
    await mkdir(join(project, ...segments.slice(0, -1)), {recursive: true})
    await writeFile(join(project, source), content)
  }
  return {project, directory, write}
}

test("общие, Project, Repo и Package правила доставляются в порядке физической ancestry", async () => {
  const f = await fixture()
  await f.write("meta/notes/common-agent-rules.md", "Общие пользовательские правила")
  await f.write("meta/notes/agent-rules.md", "Project")
  await f.write("repo/AGENTS.md", "Repo legacy")
  await f.write("repo/package/meta/notes/agent-rules.md", "Package")
  const read = createInstructionsReader(f.project)
  const result = read(f.directory)
  expect(result.map(item => ({source: item.source, content: item.content}))).toEqual([
    {source: "meta/notes/common-agent-rules.md", content: "Общие пользовательские правила"},
    {source: "meta/notes/agent-rules.md", content: "Project"},
    {source: "repo/AGENTS.md", content: "Repo legacy"},
    {source: "repo/package/meta/notes/agent-rules.md", content: "Package"},
  ])
  expect(result.every(item => /^[a-f0-9]{64}$/u.test(item.contentHash ?? ""))).toBeTrue()
  expect(read(f.project).map(item => item.source)).toEqual(["meta/notes/common-agent-rules.md", "meta/notes/agent-rules.md"])
})

test("canonical rules заменяют только fallback своей директории, отсутствующие файлы не создаются", async () => {
  const f = await fixture()
  const read = createInstructionsReader(f.project)
  expect(read(f.directory)).toEqual([])
  expect(await readdir(f.project)).toEqual(["repo"])
  expect(await readdir(f.directory)).toEqual([])
  await f.write("AGENTS.md", "Project fallback")
  await f.write("repo/AGENTS.md", "Legacy Repo")
  await f.write("repo/meta/notes/agent-rules.md", "Canonical Repo")
  await f.write("repo/package/AGENTS.md", "Package fallback")
  expect(read(f.directory).map(item => item.content)).toEqual(["Project fallback", "Canonical Repo", "Package fallback"])
  await f.write("repo/package/meta/notes/agent-rules.md", "")
  expect(read(f.directory).at(-1)).toMatchObject({source: "repo/package/meta/notes/agent-rules.md", content: ""})
})

test("outside directory и symlink правил не позволяют читать другой контур или fallback вместо запрещённого canonical", async () => {
  const f = await fixture()
  const outside = await mkdtemp(join(tmpdir(), "other-rules-"))
  cleanups.push(() => rm(outside, {recursive: true, force: true}))
  await writeFile(join(outside, "secret.md"), "Другой контур")
  const read = createInstructionsReader(f.project)
  expect(() => read(outside)).toThrow()
  await symlink(outside, join(f.project, "shortcut"))
  expect(() => read(join(f.project, "shortcut"))).toThrow()
  await f.write("repo/AGENTS.md", "Нельзя перейти сюда при запрещённом canonical")
  await mkdir(join(f.project, "repo/meta/notes"), {recursive: true})
  await symlink(join(outside, "secret.md"), join(f.project, "repo/meta/notes/agent-rules.md"))
  expect(() => read(f.directory)).toThrow()
})

test("бюджет правил даёт явный отказ вместо обрезанной политики", async () => {
  const f = await fixture()
  await f.write("AGENTS.md", "a".repeat(8 * 1024 * 1024 + 1))
  try { createInstructionsReader(f.project)(f.directory); throw new Error("Ожидался отказ бюджета") }
  catch (error) { expect(error).toMatchObject({code: "LIMIT_EXCEEDED", status: 413}) }
})

test("bootstrap и инспекция сохраняют доставленный снимок, knowledge instructions читает текущую цепочку", async () => {
  const f = await fixture()
  await f.write("meta/notes/common-agent-rules.md", "Общие")
  await f.write("repo/package/meta/notes/agent-rules.md", "Первая редакция")
  const host = createServerEnvironment({project: f.project, projectName: () => "Project",
    graph: () => ({nodes: [{id: "package", urlPath: "/package", label: "Package", kind: "package",
      packageId: "@sample/package", childIds: [], source: {path: join(f.directory, "package.json")}}]} as unknown as StorybookPackageGraphRead.Input),
    entries: () => [{path: "package", description: "Package", parent: null}],
  })
  cleanups.push(() => host.dispose())
  const assignment = await host.assignExecutor({executorId: "worker", address: "/package"})
  expect(assignment.bootstrap.instructions.map(item => item.content)).toEqual(["Общие", "Первая редакция"])
  const own = async (arguments_: Record<string, unknown>) => {
    const response = await host.handle(new Request("http://localhost/environment", {
      method: "POST", headers: {authorization: `Bearer ${assignment.token}`},
      body: JSON.stringify({name: "knowledge.read", arguments: arguments_}),
    }))
    return (await response.json()).result
  }
  expect((await own({})).children.at(-1)).toEqual({path: "./instructions", description: "Действующие агентские правила по цепочке Project и назначенного предмета"})
  await f.write("repo/package/meta/notes/agent-rules.md", "Текущая редакция")
  expect((await own({path: "./instructions"})).instructions.map((item: {content: string}) => item.content)).toEqual(["Общие", "Текущая редакция"])
  const authority = {origin: "http://127.0.0.1:12345", controlToken: "c".repeat(43)}
  const inspect = async (path?: string) => {
    const response = await host.request(new Request(`${authority.origin}/api/environment`, {
      method: "POST", headers: {authorization: `Bearer ${authority.controlToken}`},
      body: JSON.stringify({name: "environment.inspect", arguments: {executorId: "worker", ...(path === undefined ? {} : {path})}}),
    }), authority)
    return (await response.json()).result
  }
  expect((await inspect()).instructions).toEqual(assignment.bootstrap.instructions)
  expect((await inspect("./instructions")).document).toEqual(await own({path: "./instructions"}))
  expect(assignment.bootstrap.protocol).toContain("Документы не расширяют инструментальные права")
})
