import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import createServerEnvironment from "../src/environment"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"

const cleanups: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const storybookRoot = resolve(import.meta.dir, "../../..")

async function fixture(toolRoot = storybookRoot) {
  const project = await mkdtemp(join(tmpdir(), "knowledge-notes-"))
  cleanups.push(() => rm(project, {recursive: true, force: true}))
  for (const name of ["a", "b"]) await mkdir(join(project, name))
  await writeFile(join(project, "a/file.txt"), "Область a")
  const nodes = ["a", "b"].map(name => ({id: name, urlPath: `/${name}`, label: name,
    packageId: `@sample/${name}`, kind: "package", childIds: [], source: {path: join(project, name, "package.json")}}))
  const environment = createServerEnvironment({
    project, toolRoot, projectName: () => "Project",
    graph: () => ({nodes} as unknown as StorybookPackageGraphRead.Input),
    entries: () => nodes.map(node => ({path: node.id, label: node.label, parent: null, description: `Предмет ${node.id}`})),
  })
  cleanups.push(() => environment.dispose())
  const assignment = await environment.acquireSession({executorId: "worker", executorLabel: "Пример", address: "/a", sessionId: "knowledge-fixture"}, () => {}, async () => {})
  const request = (name: string, arguments_: Record<string, unknown>) => assignment.execute(new Request("http://localhost/environment", {
    method: "POST", headers: {authorization: `Bearer ${assignment.token}`}, body: JSON.stringify({name, arguments: arguments_}),
  }))
  const read = async (path?: string) => {
    const response = await request("knowledge.read", path === undefined ? {} : {path})
    return {response, body: await response.json()}
  }
  return {project, environment, assignment, request, read}
}

test("root знаний публикует точные переходы к owner notes и реальным нормативным источникам", async () => {
  const f = await fixture()
  const root = await f.read()
  expect(root.body.result.children).toEqual([
    {path: "./meta/notes", description: "Заметки назначенного владельца из meta/notes"},
    {path: "./rules/documents", description: "Основания и нормативные документы Storybook"},
    {path: "./instructions", description: "Действующие агентские правила по цепочке Project и назначенного предмета"},
  ])
  const rules = await f.read(root.body.result.children[1].path)
  const foundations = rules.body.result.children.find((item: {path: string}) => item.path.endsWith("project/meta/notes/foundations/index.md"))
  expect(foundations).toBeDefined()
  const document = await f.read(foundations.path)
  expect(document.body.result.content).toBe(await readFile(join(storybookRoot, "project/meta/notes/foundations/index.md"), "utf8"))
  expect(document.body.result.source).toEqual({path: "project/meta/notes/foundations/index.md"})
  expect(document.body.result.children.map((item: {path: string}) => item.path)).toEqual([
    "./rules/documents/project/meta/notes/foundations/meaning.md",
    "./rules/documents/project/meta/notes/foundations/emergence.md",
    "./rules/documents/project/meta/notes/foundations/coherence.md",
    "./rules/documents/project/meta/notes/foundations/simplicity.md",
    "./rules/documents/project/meta/notes/foundations/knowledge.md",
    "./rules/documents/project/meta/notes/foundations/creation.md",
  ])
  expect(document.body.result.contentHash).toMatch(/^[a-f0-9]{64}$/u)
  const structure = rules.body.result.children.find((item: {path: string}) => item.path.endsWith("package/src/architecture.md"))
  expect((await f.read(structure.path)).body.result.content).toBe(await readFile(join(storybookRoot, "package/src/architecture.md"), "utf8"))
})

test("меню не читает и не разрешает все Markdown заранее, недоступный источник отказывает только при выборе", async () => {
  const toolRoot = await mkdtemp(join(tmpdir(), "knowledge-tool-"))
  cleanups.push(() => rm(toolRoot, {recursive: true, force: true}))
  await mkdir(join(toolRoot, "project/meta/notes/foundations"), {recursive: true})
  await writeFile(join(toolRoot, "project/meta/notes/foundations/index.md"), "# Доступный источник")
  const f = await fixture(toolRoot)
  await symlink(join(f.project, "b"), join(f.project, "a/meta"))
  await mkdir(join(toolRoot, "project/src"), {recursive: true})
  await symlink(join(f.project, "a/file.txt"), join(toolRoot, "project/src/architecture.md"))
  expect((await f.read()).response.status).toBe(200)
  expect((await f.read("./rules/documents")).response.status).toBe(200)
  expect((await f.read("./rules/documents/project/meta/notes/foundations/index.md")).body.result.content).toBe("# Доступный источник")
  expect((await f.read("./rules/documents/project/src/architecture.md")).response.status).toBe(403)
  expect((await f.read("./meta/notes")).response.status).toBe(403)
  expect((await f.read("./rules/documents/contracts/meta/notes/draft-contracts.md")).response.status).toBe(404)
})

test("заметки принадлежат текущему owner, читаются целиком и обновляются из исходника без второго cache", async () => {
  const f = await fixture()
  await mkdir(join(f.project, "a/meta/notes/decision/nested"), {recursive: true})
  await mkdir(join(f.project, "b/meta/notes"), {recursive: true})
  await writeFile(join(f.project, "a/meta/notes/decision/index.md"), "# Решение\nСамостоятельный обзор.")
  await writeFile(join(f.project, "a/meta/notes/decision/nested/hello world.md"), "# Подробности\nПривет, Владимир")
  await writeFile(join(f.project, "a/meta/notes/private.json"), '{"secret":true}')
  await writeFile(join(f.project, "b/meta/notes/private.md"), "Чужая область")
  const menu = await f.read("./meta/notes")
  expect(menu.body.result.children.map((item: {path: string}) => item.path)).toEqual(["./meta/notes/decision"])
  const decision = await f.read(menu.body.result.children[0].path)
  expect(decision.body.result.content).toBe("# Решение\nСамостоятельный обзор.")
  expect(decision.body.result.children).toEqual([{description: "nested", path: "./meta/notes/decision/nested"}])
  const nested = await f.read(decision.body.result.children[0].path)
  const first = await f.read(nested.body.result.children[0].path)
  expect(first.body.result.content).toBe("# Подробности\nПривет, Владимир")
  await writeFile(join(f.project, "a/meta/notes/decision/nested/hello world.md"), "# Изменено у владельца")
  const second = await f.read(nested.body.result.children[0].path)
  expect(second.body.result.content).toBe("# Изменено у владельца")
  expect(second.body.result.contentHash).not.toBe(first.body.result.contentHash)
  expect((await f.read("./meta/notes/private.json")).response.status).toBe(403)
})

test("escape, непубликованные нормативные источники и ссылки наружу не расширяют файловый scope", async () => {
  const f = await fixture()
  await mkdir(join(f.project, "a/meta/notes"), {recursive: true})
  await symlink(join(f.project, "a/file.txt"), join(f.project, "a/meta/notes/outside.md"))
  for (const path of [
    "./meta/notes/../../file.txt",
    "./meta/notes/%2e%2e/file.txt",
    "./meta/notes/%2Fetc%2Fpasswd.md",
    "./meta/notes/outside.md",
    "./rules/documents/README.md",
    "./rules/documents/../../AGENTS.md",
  ]) expect((await f.read(path)).response.status).toBe(403)
  expect((await f.read(join(f.project, "b/private.md"))).response.ok).toBeFalse()
  const document = await f.read("./rules/documents/project/meta/notes/foundations/index.md")
  expect(document.response.status).toBe(200)
  const ownFile = await f.request("filesystem.read", {path: "file.txt"})
  expect((await ownFile.json()).result.content).toBe("Область a")
  expect((await f.request("filesystem.read", {path: "../b/meta/notes/private.md"})).status).toBe(403)
})

test("environment.inspect читает ту же owner note и те же нормы, собственный Project root инспектора сохраняется", async () => {
  const f = await fixture()
  await mkdir(join(f.project, "a/meta/notes"), {recursive: true})
  await writeFile(join(f.project, "a/meta/notes/decision.md"), "# Только предмет a")
  const authority = {origin: "http://127.0.0.1:12345", controlToken: "c".repeat(43)}
  const inspector = async (path: string) => {
    const response = await f.environment.request(new Request(`${authority.origin}/api/environment`, {
      method: "POST", headers: {authorization: `Bearer ${authority.controlToken}`},
      body: JSON.stringify({name: "environment.inspect", arguments: {executorId: "worker", path}}),
    }), authority)
    return (await response.json()).result.document
  }
  expect(await inspector("./meta/notes/decision.md")).toEqual((await f.read("./meta/notes/decision.md")).body.result)
  expect(await inspector("./rules/documents/project/meta/notes/foundations/index.md"))
    .toEqual((await f.read("./rules/documents/project/meta/notes/foundations/index.md")).body.result)
  const response = await f.environment.request(new Request(`${authority.origin}/api/environment`, {
    method: "POST", headers: {authorization: `Bearer ${authority.controlToken}`}, body: JSON.stringify({name: "knowledge.read", arguments: {}}),
  }), authority)
  expect((await response.json()).result.children.map((item: {path: string}) => item.path))
    .toEqual(["./a", "./b", "./meta/notes", "./rules/documents", "./instructions"])
})

test("непрочитанные заметки сохраняют identity области, превышение бюджета не выдаётся за полный документ", async () => {
  const f = await fixture()
  await mkdir(join(f.project, "a/meta/notes"), {recursive: true})
  await writeFile(join(f.project, "a/meta/notes/large.md"), Buffer.alloc(8 * 1024 * 1024 + 1, "a"))
  const large = await f.read("./meta/notes/large.md")
  expect(large.response.status).toBe(413)
  expect(large.body.error.code).toBe("LIMIT_EXCEEDED")
  await rename(join(f.project, "a"), join(f.project, "old-a"))
  await symlink(join(f.project, "b"), join(f.project, "a"))
  expect((await f.read("./meta/notes")).response.status).toBe(403)
})
