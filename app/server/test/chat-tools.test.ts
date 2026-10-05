import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, readFile, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createChatServer} from "../src/chat"
import createJournal from "@zavx0z/storybook-app-server-requests"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"

const cleanups: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

test("единый HTTP endpoint доставляет инструменты двух назначений и сохраняет источник журнала", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"))
  cleanups.push(() => rm(root, {recursive: true, force: true}))
  for (const name of ["a", "b"]) await mkdir(join(root, name))
  const connections: StorybookTechAcp.Input[] = []
  const journal = createJournal()
  const nodes = ["a", "b"].map(name => ({id: name, urlPath: `/${name}`, label: name, packageId: name,
    kind: "package", source: {path: join(root, name, "package.json")}, childIds: []}))
  const host = createChatServer({
    project: root, projectName: () => "Project", toolRoot: root,
    graph: () => ({nodes} as unknown as StorybookPackageGraphRead.Input),
    entries: () => nodes.map(node => ({path: node.id, description: node.id, parent: null,
      readType: async () => ({status: "confirmed", type: "Component"})})),
    recordRequest: entry => journal.write(entry),
    async connect(input) {
      connections.push(input)
      return {sessionId: `session-${connections.length}`, capabilities: {}, configOptions: [], async setConfigOption() { return [] },
        async prompt() { return {stopReason: "end_turn"} }, async cancel() {}, async dispose() {}}
    },
  })
  cleanups.push(() => host.dispose())
  // Настоящий HTTP-транспорт использует единую среду, без AI HTTP и MCP runtime.
  const http: Bun.Server<unknown> = Bun.serve<unknown>({hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (new URL(request.url).pathname !== "/api/environment") return Response.json({error: {code: "NOT_FOUND"}}, {status: 404})
    return host.environment.request(request, {origin: http.url.origin, controlToken: "c".repeat(43)})
  }})
  cleanups.push(() => http.stop(true))
  const keys: string[] = []
  for (const name of ["a", "b"]) {
    await host.chats.prepare(`/${name}`)
    expect(connections.at(-1)!.mcpServers).toEqual([])
    const {executorId} = await host.chats.read(`/${name}`)
    keys.push((await host.environment.assignExecutor({executorId, address: `/${name}`})).token)
  }
  const call = (key: string, command?: unknown) => fetch(new URL("/api/environment", http.url), {
    method: command === undefined ? "GET" : "POST",
    headers: {authorization: `Bearer ${key}`, "content-type": "application/json"},
    ...(command === undefined ? {} : {body: JSON.stringify(command)}),
  })
  const catalog = (await (await call(keys[0]!)).json()).result
  expect(catalog.tools.map((tool: {name: string}) => tool.name)).toContain("filesystem.apply-patch")
  expect(catalog.tools).toHaveLength(13)
  expect(catalog.tools.map((tool: {name: string}) => tool.name)).toEqual(expect.arrayContaining(["knowledge.read", "team.list", "team.send"]))
  expect(catalog.tools.map((tool: {name: string}) => tool.name)).not.toContain("git.status")
  expect(catalog.tools.map((tool: {name: string}) => tool.name)).not.toContain("storybook")
  const read = catalog.tools.find((tool: {name: string}) => tool.name === "filesystem.read")!
  expect(read.inputSchema).toMatchObject({type: "object", additionalProperties: false})
  expect(read.inputSchema.properties).not.toHaveProperty("root")
  const content = '/Users/example/source\n{"url":"http://localhost:1234","packageRoot":"literal data"}'
  expect((await call(keys[0]!, {name: "filesystem.create", arguments: {path: "file.txt", content}})).status).toBe(200)
  expect((await call(keys[1]!, {name: "filesystem.create", arguments: {path: "file.txt", content: "second"}})).status).toBe(200)
  const response = await call(keys[0]!, {name: "filesystem.read", arguments: {path: "file.txt"}})
  expect((await response.json()).result).toMatchObject({path: "file.txt", content})
  expect(await readFile(join(root, "a/file.txt"), "utf8")).toBe(content)
  const denied = await call(keys[0]!, {name: "filesystem.read", arguments: {path: "../b/file.txt"}})
  expect(denied.status).toBe(403)
  const failure = await denied.json()
  expect(failure.error.code).toBe("PATH_NOT_ALLOWED")
  expect(JSON.stringify(failure)).not.toContain(root)
  await call(keys[0]!, {name: "knowledge.read", arguments: {path: "."}})
  expect((await (await call(keys[0]!, {name: "filesystem.read", arguments: {path: "file.txt"}})).json()).result).toMatchObject({content})
  expect(journal.read("/a").map(entry => entry.tool)).toContain("filesystem.read")
  expect(journal.read("/a").some(entry => entry.status === "failed")).toBeTrue()
  expect(journal.read("/b")).toHaveLength(1)
  expect(journal.read()).toHaveLength(journal.read("/a").length + 1)
  for (const key of keys) expect(JSON.stringify(journal.read())).not.toContain(key)
  await host.dispose()
  expect((await call(keys[0]!)).status).toBe(401)
  expect((await call(keys[0]!, {name: "filesystem.read", arguments: {path: "file.txt"}})).status).toBe(401)
})
