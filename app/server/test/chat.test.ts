import {afterEach, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createChatServer} from "../src/chat"
import type {StorybookTechAcp} from "@storybook-tech/acp"
import type {StorybookPackageGraphRead} from "@storybook-package-graph/read"
import type {StorybookAppMcpRest} from "@storybook-app-mcp/rest"

const releases: (() => Promise<void>)[] = []
afterEach(async () => { for (const release of releases.splice(0).reverse()) await release() })

async function fixture(
  configOptions: StorybookTechAcp.Output["configOptions"] = [],
  readType?: StorybookAppMcpRest.Input[1]["entries"][number]["readType"],
) {
  let prompts = 0
  const project = await mkdtemp(join(tmpdir(), "storybook-chat-server-"))
  releases.push(() => rm(project, {recursive: true, force: true}))
  const nodes = [
    {id: "repo", urlPath: "/repo", label: "Repo", packageId: "@scope/repo", kind: "directory", source: {path: project}, childIds: ["button", "button-other"]},
    {id: "button", urlPath: "/repo/button", label: "Button", packageId: "@scope/button", kind: "package", source: {path: join(project, "package.json")}, childIds: ["child"]},
    {id: "child", urlPath: "/repo/button/part", label: "Part", packageId: "@scope/button", kind: "directory", source: {path: project}, childIds: []},
    {id: "button-other", urlPath: "/repo/button-other", label: "Other", packageId: "@scope/other", kind: "package", source: {path: join(project, "package.json")}, childIds: []},
  ]
  const entries = nodes.map(node => ({path: node.urlPath.slice(1), label: node.label, description: node.label, parent: null,
    ...(node.kind === "package" && readType !== undefined ? {readType} : {}),
  }))
  const connections: StorybookTechAcp.Input[] = []
  const server = createChatServer({
    project, projectName: () => "Project", toolRoot: project, origin: () => "http://127.0.0.1:12345",
    graph: () => ({nodes} as unknown as StorybookPackageGraphRead.Input), entries: () => entries,
    async connect(input) {
      connections.push(input)
      return {
        sessionId: "acp-session",
        get configOptions() { return configOptions },
        async setConfigOption(id, value) {
          configOptions = configOptions.map(option => option.type === "select" && option.id === id ? {...option, currentValue: value} : option)
          return configOptions
        },
        async prompt() {
          prompts += 1
          return {stopReason: "end_turn"}
        },
        async cancel() {},
        async dispose() {},
      }
    },
  })
  releases.push(() => server.dispose())
  return {server, connections, prompts: () => prompts}
}

const scopedRequest = (key: string, input: object) => new Request("http://127.0.0.1:12345/api/chat/mcp", {
  method: "POST", headers: {authorization: `Bearer ${key}`, "content-type": "application/json"}, body: JSON.stringify(input),
})

test("пустой MCP-вызов открывает назначенный предмет, прямой чужой адрес запрещён", async () => {
  const {server, connections} = await fixture()
  await server.chats.prompt("/repo/button", "Привет", "1")
  while (connections.length === 0) await Bun.sleep(5)
  const mcp = connections[0]!.mcpServers[0]!
  if (!("env" in mcp)) throw new Error("Ожидается stdio MCP")
  const key = mcp.env.find(entry => entry.name === "STORYBOOK_CHAT_KEY")!.value
  const root = await server.scopedMcp(scopedRequest(key, {}))
  expect(root.status).toBe(200)
  expect(await root.json()).toMatchObject({path: "repo/button", scope: {path: "repo/button", label: "Button"}})
  expect((await server.scopedMcp(scopedRequest(key, {path: "repo/button/part"}))).status).toBe(200)
  expect((await server.scopedMcp(scopedRequest(key, {path: "repo/button-other"}))).status).toBe(403)
  expect((await server.scopedMcp(scopedRequest(key, {path: "repo"}))).status).toBe(403)
  expect((await server.scopedMcp(scopedRequest("invalid", {}))).status).toBe(401)
  await server.dispose()
  expect((await server.scopedMcp(scopedRequest(key, {}))).status).toBe(401)
})

test("подписка передаёт историю и её закрытие не отменяет чат", async () => {
  const {server} = await fixture()
  const snapshots: unknown[] = []
  const release = await server.subscribe("/repo/button", snapshot => snapshots.push(snapshot))
  expect(snapshots).toHaveLength(1)
  expect(snapshots[0]).toMatchObject({address: "/repo/button", status: "idle", messages: []})
  const before = await server.chats.read("/repo/button")
  release()
  release()
  expect((await server.chats.read("/repo/button")).id).toBe(before.id)
  const retired = await server.request(new Request("http://127.0.0.1:12345/api/browser/chat/events?address=/repo/button"))
  expect(retired.status).toBe(410)
  expect(await retired.json()).toEqual({error: "События чата доступны через WebSocket /api/events"})
})

test("адресный чат выбирает предметный MCP после проверки grant", async () => {
  let reads = 0
  const {server, connections} = await fixture([], async () => {
    reads += 1
    return {status: "confirmed", type: "Component", revision: "verified"}
  })
  await server.chats.prepare("/repo/button")
  const mcp = connections[0]!.mcpServers[0]!
  if (!("env" in mcp)) throw new Error("Ожидается stdio MCP")
  const key = mcp.env.find(entry => entry.name === "STORYBOOK_CHAT_KEY")!.value
  expect(await (await server.scopedMcp(scopedRequest(key, {}))).json())
    .toMatchObject({path: "repo/button", status: "not-implemented", description: "Предметный MCP для Component ещё не реализован.",
      verification: {status: "confirmed", type: "Component", revision: "verified"}, scope: {path: "repo/button", label: "Button"}})
  expect(reads).toBe(1)
  expect((await server.scopedMcp(scopedRequest(key, {path: "repo/button-other"}))).status).toBe(403)
  expect(reads, "Чужой адрес не читает отчёт до проверки полномочий").toBe(1)
})


test("HTTP настройки используют ту же ACP-сессию без отправки сообщения", async () => {
  const f = await fixture([{id: "selected-model", category: "model", type: "select", name: "Model", currentValue: "a",
    options: [{value: "a", name: "A"}, {value: "b", name: "B"}]}])
  const request = (operation: string, values = {}) => f.server.request(new Request(`http://127.0.0.1:12345/api/browser/chat/${operation}`, {
    method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({address: "/repo/button", ...values}),
  }))
  expect(await (await request("prepare")).json()).toMatchObject({settings: [{id: "selected-model", value: "a"}], messages: [], configuring: false})
  expect(await (await request("configure", {id: "selected-model", value: "b"})).json()).toMatchObject({settings: [{value: "b"}], messages: []})
  expect(f.connections).toHaveLength(1)
  expect(f.connections[0]!.config, "Начальные модели и мышление определяет адаптер, не жёстко заданный config приложения").toBeUndefined()
  expect(f.prompts()).toBe(0)
})
