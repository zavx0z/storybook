import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createChatServer} from "../src/chat"
import createJournal from "@zavx0z/storybook-app-server-requests"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"

const cleanups: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture() {
  const project = await mkdtemp(join(tmpdir(), "server-environment-"))
  cleanups.push(() => rm(project, {recursive: true, force: true}))
  for (const directory of ["a", "b", "rules"]) await mkdir(join(project, directory))
  await writeFile(join(project, "a/file.txt"), "a")
  await writeFile(join(project, "b/file.txt"), "b")
  const nodes = [
    {id: "a", urlPath: "/a", label: "a", kind: "package", packageId: "@sample/a", source: {path: join(project, "a/package.json")}, childIds: ["detail"]},
    {id: "detail", urlPath: "/a/detail", label: "detail", kind: "directory", packageId: "@sample/a", source: {path: join(project, "a")}, childIds: []},
    {id: "b", urlPath: "/b", label: "b", kind: "package", packageId: "@sample/b", source: {path: join(project, "b/package.json")}, childIds: []},
    {id: "rules", urlPath: "/storybook/package/reader", label: "Package", kind: "package", packageId: "@zavx0z/storybook-package-reader", source: {path: join(project, "rules/package.json")}, childIds: ["rule-detail"]},
    {id: "rule-detail", urlPath: "/storybook/package/reader/contract", label: "Contract", kind: "directory", packageId: "@zavx0z/storybook-package-reader", source: {path: join(project, "rules")}, childIds: []},
  ]
  const entries = nodes.map(node => ({
    path: node.urlPath.slice(1),
    label: node.label,
    description: node.label,
    parent: nodes.find(parent => parent.childIds.includes(node.id))?.urlPath.slice(1) ?? null,
    ...(node.kind !== "package" ? {} : {readType: async () => ({status: "confirmed" as const, type: "Component" as const})}),
  }))
  const connections: StorybookTechAcp.Input[] = []
  const disposedConnections: string[] = []
  const journal = createJournal()
  const controlToken = "c".repeat(43)
  let http!: Bun.Server<unknown>
  const chat = createChatServer({
    project,
    projectName: () => "Project",
    toolRoot: project,
    graph: () => ({nodes} as unknown as StorybookPackageGraphRead.Input),
    entries: () => entries,
    recordRequest: entry => journal.write(entry),
    async connect(input) {
      connections.push(input)
      const id = `provider-session-${connections.length}`
      return {
        sessionId: id,
        capabilities: {},
        configOptions: [],
        async setConfigOption() { return [] },
        async prompt(content) {
          if (content === "Отказ модели" || typeof content !== "string" && content.some(block => block.type === "text" && block.text === "Отказ модели")) throw new Error("Модель недоступна")
          return {stopReason: "end_turn"}
        },
        async cancel() {},
        async dispose() { disposedConnections.push(id) },
      }
    },
  })
  cleanups.push(() => chat.dispose())
  http = Bun.serve<unknown>({hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/api/environment") return chat.environment.request(request, {origin: http.url.origin, controlToken})
    return Response.json({error: "Unknown route"}, {status: 404})
  }})
  cleanups.push(() => http.stop(true))
  const call = (token: string | undefined, command?: unknown, headers: Record<string, string> = {}) => fetch(new URL("/api/environment", http.url), {
    method: command === undefined ? "GET" : "POST",
    headers: {...headers, ...(token === undefined ? {} : {authorization: `Bearer ${token}`})},
    ...(command === undefined ? {} : {body: JSON.stringify(command)}),
  })
  return {project, chat, http, call, controlToken, connections, disposedConnections, journal}
}

test("единый HTTP вход даёт глобальный контекст независимо от старта модели и проверяет штатные полномочия сервера", async () => {
  const f = await fixture()
  expect((await f.call(undefined)).status).toBe(401)
  expect((await f.call("wrong")).status).toBe(401)
  expect((await f.call("d".repeat(43))).status).toBe(401)
  const response = await f.call(f.controlToken)
  const bootstrap = (await response.json()).result
  expect(bootstrap).toMatchObject({executorId: "developer:project", subject: {address: "/", label: "Project", type: "Project"}})
  expect(bootstrap.tools.map((tool: {name: string}) => tool.name)).toContain("environment.inspect")
  expect(JSON.stringify(bootstrap)).not.toContain(f.controlToken)
  expect(bootstrap).not.toHaveProperty("token")
  expect(bootstrap.subject).not.toHaveProperty("directory")
  expect(f.connections).toHaveLength(0)
  const wrongOrigin = await f.call(f.controlToken, undefined, {origin: "http://untrusted.invalid"})
  expect(wrongOrigin.status).toBe(403)
  expect((await wrongOrigin.json()).error.code).toBe("invalid-origin")
  const wrongHost = await f.call(f.controlToken, undefined, {host: "untrusted.invalid"})
  expect(wrongHost.status).toBe(421)
})

test("локальное назначение доступно до ACP, повторно выдаётся тому же executor и сохраняет файловый scope", async () => {
  const f = await fixture()
  const executorId = (await f.chat.chats.read("/a")).executorId
  const assigned = await f.chat.environment.assignExecutor({executorId, address: "/a"})
  expect(f.connections).toHaveLength(0)
  const bootstrap = (await (await f.call(assigned.token)).json()).result
  expect(bootstrap.executorId).toBe(executorId)
  await f.chat.chats.prepare("/a")
  expect(f.connections[0]!.mcpServers).toEqual([])
  expect((await f.chat.environment.assignExecutor({executorId, address: "/a"})).token).toBe(assigned.token)
  await expect(f.chat.environment.assignExecutor({executorId, address: "/b"})).rejects.toMatchObject({code: "CONFLICT"})
  const own = await f.call(assigned.token, {name: "filesystem.read", arguments: {path: "file.txt"}})
  expect((await own.json()).result).toMatchObject({content: "a", path: "file.txt"})
  const outside = await f.call(assigned.token, {name: "filesystem.read", arguments: {path: "../b/file.txt"}})
  expect(outside.status).toBe(403)
  const inspector = await f.call(assigned.token, {name: "environment.inspect", arguments: {executorId}})
  expect(inspector.status).toBe(403)
  const source = f.journal.read("/a")
  expect(source.every(entry => entry.agentId === executorId)).toBeTrue()
  expect(source.map(entry => entry.status)).toContain("failed")
  expect(f.journal.read()).toHaveLength(source.length)
})

test("внешний controlToken видит фактические знания локального исполнителя и общие нормы с той же точки отсчёта", async () => {
  const f = await fixture()
  const worker = await f.chat.environment.assignExecutor({executorId: "local-worker", address: "/a"})
  const inspected = await f.call(f.controlToken, {name: "environment.inspect", arguments: {executorId: "local-worker", path: "."}})
  const value = (await inspected.json()).result
  const own = await f.call(worker.token, {name: "knowledge.read", arguments: {}})
  expect(value.document).toEqual((await own.json()).result)
  expect(value.document.children).toContainEqual({description: "Package", path: "./rules/storybook/package/reader"})
  const norm = await f.call(f.controlToken, {name: "environment.inspect", arguments: {executorId: "local-worker", path: "./rules/storybook/package/reader/contract"}})
  expect((await norm.json()).result.document).toMatchObject({path: "./rules/storybook/package/reader/contract", description: "Contract"})
  const localNorm = await f.call(worker.token, {name: "knowledge.read", arguments: {path: "./rules/storybook/package/reader/contract"}})
  expect(localNorm.status).toBe(200)
  const illegal = await f.call(worker.token, {name: "knowledge.read", arguments: {path: "./b"}})
  expect(illegal.status).toBe(403)
  const project = await f.call(f.controlToken, {name: "knowledge.read", arguments: {}})
  expect((await project.json()).result.children.map((entry: {path: string}) => entry.path)).toContain("./b")
  expect(JSON.stringify(value)).not.toContain(worker.token)
  expect(JSON.stringify(value)).not.toContain(f.controlToken)
  expect(f.journal.read("/").every(entry => entry.agentId === "developer:project")).toBeTrue()
  expect(f.journal.read("/a").every(entry => entry.agentId === "local-worker")).toBeTrue()
  expect(f.journal.read()).toHaveLength(f.journal.read("/").length + f.journal.read("/a").length)
})

test("dispose и reconnect ACP не отзывают bearer окружения, остановка сервера отзывает", async () => {
  const f = await fixture()
  await f.chat.chats.prepare("/a")
  const executorId = (await f.chat.chats.read("/a")).executorId
  const first = (await f.chat.environment.assignExecutor({executorId, address: "/a"})).token
  await f.chat.chats.prompt("/a", "Отказ модели", "failure-request")
  for (let attempt = 0; attempt < 100 && (await f.chat.chats.read("/a")).status !== "failed"; attempt++) await Bun.sleep(5)
  expect((await f.chat.chats.read("/a")).status).toBe("failed")
  expect(f.disposedConnections).toEqual(["provider-session-1"])
  expect((await f.call(first)).status).toBe(200)
  await f.chat.chats.prepare("/a")
  expect(f.connections).toHaveLength(2)
  expect((await f.chat.environment.assignExecutor({executorId, address: "/a"})).token).toBe(first)
  expect(f.connections[1]!.mcpServers).toEqual([])
  expect((await f.chat.chats.read("/a")).executorId).toBe(executorId)
  await f.chat.dispose()
  expect((await f.call(first)).status).toBe(401)
  expect((await f.call(f.controlToken)).status).toBe(401)
})

test("единый endpoint описывает и исполняет инструменты с тем же назначением, журналом и неповреждённым результатом", async () => {
  const f = await fixture()
  const worker = await f.chat.environment.assignExecutor({executorId: "worker", address: "/a"})
  const catalog = await f.call(worker.token)
  const tools = (await catalog.json()).result.tools
  expect(tools).toHaveLength(13)
  expect(tools.map((tool: {name: string}) => tool.name)).toEqual(expect.arrayContaining(["team.list", "team.send"]))
  expect(tools.map((tool: {name: string}) => tool.name)).toContain("knowledge.read")
  const content = '/Users/example/source\n{"packageRoot":"literal data"}'
  const created = await f.call(worker.token, {name: "filesystem.create", arguments: {path: "new.txt", content}})
  expect(created.status).toBe(200)
  const read = await f.call(worker.token, {name: "filesystem.read", arguments: {path: "new.txt"}})
  expect((await read.json()).result.content).toBe(content)
  expect(await readFile(join(f.project, "a/new.txt"), "utf8")).toBe(content)
  const knowledge = await f.call(worker.token, {name: "knowledge.read", arguments: {}})
  expect((await knowledge.json()).result.path).toBe(".")
  expect(f.journal.read("/a").map(entry => entry.tool)).toEqual(["knowledge.read", "filesystem.read", "filesystem.create"])
  expect(f.journal.read("/a").every(entry => entry.agentId === "worker")).toBeTrue()
  expect(JSON.stringify(f.journal.read())).not.toContain(worker.token)
  expect(f.chat.environment.revokeExecutor("worker")).toBeTrue()
  expect((await f.call(worker.token)).status).toBe(401)
  expect((await f.call(worker.token, {name: "filesystem.read", arguments: {path: "new.txt"}})).status).toBe(401)
})
