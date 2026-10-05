import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, readFile, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {Client, InMemoryTransport} from "@modelcontextprotocol/client"
import {createChatServer} from "../src/chat"
import createMcp from "../../mcp/src/chat"
import createJournal from "@zavx0z/storybook-app-server-requests"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"

const cleanups: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

test("переходный MCP-клиент доставляет инструменты общему окружению и сохраняет источник журнала", async () => {
  const root = await mkdtemp(join(tmpdir(), "chat-tools-"))
  cleanups.push(() => rm(root, {recursive: true, force: true}))
  for (const name of ["a", "b"]) await mkdir(join(root, name))
  const connections: StorybookTechAcp.Input[] = []
  const journal = createJournal()
  const nodes = ["a", "b"].map(name => ({id: name, urlPath: `/${name}`, label: name, packageId: name,
    kind: "package", source: {path: join(root, name, "package.json")}, childIds: []}))
  const host = createChatServer({
    project: root, projectName: () => "Project", toolRoot: root, origin: () => "http://127.0.0.1:12345",
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
  // Настоящий HTTP-транспорт ведёт только к существующему хосту Storybook, без AI server.
  const http = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (new URL(request.url).pathname === "/api/chat/tools") return host.scopedTools(request,
      request.method === "POST" ? await request.json() : undefined)
    return host.scopedMcp(request)
  }})
  cleanups.push(() => http.stop(true))
  const clients: Client[] = []
  const keys: string[] = []
  for (const name of ["a", "b"]) {
    await host.chats.prepare(`/${name}`)
    expect(connections.at(-1)!.mcpServers).toEqual([])
    const {executorId} = await host.chats.read(`/${name}`)
    const key = (await host.environment.assignExecutor({executorId, address: `/${name}`})).token
    keys.push(key)
    const server = await createMcp({origin: http.url.origin, key})
    const client = new Client({name, version: "1"})
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(ct), server.connect(st)])
    clients.push(client)
    cleanups.push(async () => {
      await client.close()
      await server.close()
    })
  }
  const [a, b] = clients as [Client, Client]
  const catalog = await a.listTools()
  expect(catalog.tools.map(tool => tool.name)).toContain("filesystem.apply-patch")
  expect(catalog.tools).toHaveLength(13)
  expect(catalog.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(["team.list", "team.send"]))
  expect(catalog.tools.map(tool => tool.name)).not.toContain("git.status")
  const read = catalog.tools.find(tool => tool.name === "filesystem.read")!
  expect(read.inputSchema).toMatchObject({type: "object", additionalProperties: false})
  expect(read.inputSchema.properties).not.toHaveProperty("root")
  const content = '/Users/example/source\n{"url":"http://localhost:1234","packageRoot":"literal data"}'
  expect((await a.callTool({name: "filesystem.create", arguments: {path: "file.txt", content}})).isError).not.toBeTrue()
  expect((await b.callTool({name: "filesystem.create", arguments: {path: "file.txt", content: "second"}})).isError).not.toBeTrue()
  const response = await a.callTool({name: "filesystem.read", arguments: {path: "file.txt"}})
  expect(response.structuredContent).toMatchObject({path: "file.txt", content})
  expect(await readFile(join(root, "a/file.txt"), "utf8")).toBe(content)
  const denied = await a.callTool({name: "filesystem.read", arguments: {path: "../b/file.txt"}})
  expect(denied.isError).toBeTrue()
  expect(JSON.stringify(denied)).not.toContain(root)
  await a.callTool({name: "storybook", arguments: {path: "."}})
  expect((await a.callTool({name: "filesystem.read", arguments: {path: "file.txt"}})).structuredContent).toMatchObject({content})
  expect(journal.read("/a").map(entry => entry.tool)).toContain("filesystem.read")
  expect(journal.read("/a").some(entry => entry.status === "failed")).toBeTrue()
  expect(journal.read("/b")).toHaveLength(1)
  expect(journal.read()).toHaveLength(journal.read("/a").length + 1)
  for (const key of keys) expect(JSON.stringify(journal.read())).not.toContain(key)
  await host.dispose()
  expect((await fetch(new URL("/api/chat/tools", http.url), {headers: {authorization: `Bearer ${keys[0]}`}})).status).toBe(401)
})
