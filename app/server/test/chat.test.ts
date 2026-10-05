import {afterEach, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createChatServer} from "../src/chat"
import createJournal from "@zavx0z/storybook-app-server-requests"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"
import type {StorybookAppMcpRest} from "@zavx0z/storybook-app-mcp-rest"

const releases: (() => Promise<void>)[] = []
afterEach(async () => { for (const release of releases.splice(0).reverse()) await release() })

async function fixture(
  configOptions: StorybookTechAcp.Output["configOptions"] = [],
  readType?: StorybookAppMcpRest.Input[1]["entries"][number]["readType"],
  withRules = false,
) {
  let prompts = 0
  const project = await mkdtemp(join(tmpdir(), "storybook-chat-server-"))
  releases.push(() => rm(project, {recursive: true, force: true}))
  const nodes = [
    {id: "repo", urlPath: "/repo", label: "Repo", packageId: "@scope/repo", kind: "directory", source: {path: project}, childIds: ["button", "button-other"]},
    {id: "button", urlPath: "/repo/button", label: "Button", packageId: "@scope/button", kind: "package", source: {path: join(project, "package.json")}, childIds: ["child"]},
    {id: "child", urlPath: "/repo/button/part", label: "Part", packageId: "@scope/button", kind: "directory", source: {path: project}, childIds: ["deep"]},
    {id: "button-other", urlPath: "/repo/button-other", label: "Other", packageId: "@scope/other", kind: "package", source: {path: join(project, "package.json")}, childIds: []},
  ]
  nodes.push({id: "deep", urlPath: "/repo/button/part/deep", label: "Deep", packageId: "@scope/button", kind: "directory", source: {path: project}, childIds: []})
  if (withRules) nodes.push(
    {id: "rules", urlPath: "/storybook/package/reader", label: "Package", packageId: "@zavx0z/storybook-package-reader", kind: "package", source: {path: join(project, "package.json")}, childIds: ["rule-part"]},
    {id: "rule-part", urlPath: "/storybook/package/reader/contract", label: "Contract", packageId: "@zavx0z/storybook-package-reader", kind: "directory", source: {path: project}, childIds: []},
  )
  const entries = nodes.map(node => ({path: node.urlPath.slice(1), label: node.label, description: node.label, parent: nodes.find(parent => parent.childIds.includes(node.id))?.urlPath.slice(1) ?? null,
    ...(node.kind === "package" && readType !== undefined ? {readType} : {}),
  }))
  const connections: StorybookTechAcp.Input[] = []
  const journal = createJournal()
  const server = createChatServer({
    project, projectName: () => "Project", toolRoot: project, origin: () => "http://127.0.0.1:12345",
    graph: () => ({nodes} as unknown as StorybookPackageGraphRead.Input), entries: () => entries,
    recordRequest: entry => journal.write(entry),
    async connect(input) {
      connections.push(input)
      return {
        sessionId: "acp-session",
        capabilities: {},
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
  return {server, connections, journal, prompts: () => prompts}
}

async function assignmentKey(server: ReturnType<typeof createChatServer>, address: string) {
  const {executorId} = await server.chats.read(address)
  return (await server.environment.assignExecutor({executorId, address})).token
}

const scopedRequest = (key: string, input: object) => new Request("http://127.0.0.1:12345/api/chat/mcp", {
  method: "POST", headers: {authorization: `Bearer ${key}`, "content-type": "application/json"}, body: JSON.stringify(input),
})

test("вызовы двух агентов разделяются по источнику и одновременно попадают в общий журнал", async () => {
  const {server, connections, journal} = await fixture()
  await server.chats.prepare("/repo/button")
  await server.chats.prepare("/repo/button-other")
  expect(connections.every(connection => connection.mcpServers.length === 0)).toBeTrue()
  const keys = await Promise.all(["/repo/button", "/repo/button-other"].map(address => assignmentKey(server, address)))
  await server.scopedMcp(scopedRequest(keys[0]!, {}))
  await server.scopedMcp(scopedRequest(keys[0]!, {path: "./repo/button-other"}))
  await server.scopedMcp(scopedRequest(keys[1]!, {}))
  const first = journal.read("/repo/button")
  const second = journal.read("/repo/button-other")
  expect(journal.read()).toHaveLength(3)
  expect(first).toHaveLength(2)
  expect(second).toHaveLength(1)
  expect(first.some(entry => entry.status === "failed")).toBeTrue()
  expect(first.every(entry => entry.agentId === first[0]?.agentId)).toBeTrue()
  expect(first[0]?.agentId).not.toBe(second[0]?.agentId)
  expect(first[0]?.agentId).toBeTruthy()
  expect(first.every(entry => entry.tool === "knowledge.read"),
    "Переходная карточка storybook записывает исполненную команду окружения, а не название MCP-карточки").toBeTrue()
  expect(first[0]?.agentId, "Источник журнала совпадает с устойчивой identity исполнителя беседы")
    .toBe((await server.chats.read("/repo/button")).executorId)
  for (const key of keys) expect(JSON.stringify(journal.read())).not.toContain(key)
})

test("общие правила остаются доступными переходами от root адресного чата", async () => {
  const {server, connections} = await fixture([], undefined, true)
  await server.chats.prepare("/repo/button")
  const key = await assignmentKey(server, "/repo/button")
  const root = await (await server.scopedMcp(scopedRequest(key, {}))).json()
  const rules = root.children.find((child: {path: string}) => child.path === "./rules/storybook/package/reader")
  expect(rules).toBeDefined()
  expect(root.path).toBe(".")
  expect(root).not.toHaveProperty("rules")
  const rule = await (await server.scopedMcp(scopedRequest(key, {path: rules.path}))).json()
  expect(rule.children).toEqual([{description: "Contract", path: "./rules/storybook/package/reader/contract"}])
  expect((await server.scopedMcp(scopedRequest(key, {path: rule.children[0].path}))).status).toBe(200)
  expect((await server.scopedMcp(scopedRequest(key, {path: "storybook/package/reader"}))).status).toBe(403)
})

test("пустой MCP-вызов открывает назначенный предмет, прямой чужой адрес запрещён", async () => {
  const {server, connections} = await fixture()
  await server.chats.prompt("/repo/button", "Привет", "1")
  while (connections.length === 0) await Bun.sleep(5)
  const key = await assignmentKey(server, "/repo/button")
  const root = await server.scopedMcp(scopedRequest(key, {}))
  expect(root.status).toBe(200)
  expect(await root.json()).toEqual({description: "Button", path: ".", children: [
    {description: "Part", path: "./part"},
    {path: "./meta/notes", description: "Заметки назначенного владельца из meta/notes"},
    {path: "./rules/documents", description: "Основания и нормативные документы Storybook"},
  ]})
  const part = await (await server.scopedMcp(scopedRequest(key, {path: "part"}))).json()
  expect(part).toEqual({description: "Part", path: "./part", children: [{description: "Deep", path: "./part/deep"}]})
  expect((await server.scopedMcp(scopedRequest(key, {path: part.children[0].path}))).status).toBe(200)
  expect((await server.scopedMcp(scopedRequest(key, {path: "deep"}))).status).toBe(403)
  expect(await (await server.scopedMcp(scopedRequest(key, {}))).json()).toEqual({description: "Button", path: ".", children: [
    {description: "Part", path: "./part"},
    {path: "./meta/notes", description: "Заметки назначенного владельца из meta/notes"},
    {path: "./rules/documents", description: "Основания и нормативные документы Storybook"},
  ]})
  expect((await server.scopedMcp(scopedRequest(key, {path: "repo/button/part"}))).status).toBe(403)
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

test("адресный чат выбирает инструменты окружения после проверки grant", async () => {
  let reads = 0
  const {server, connections} = await fixture([], async () => {
    reads += 1
    return {status: "confirmed", type: "Component", revision: "verified"}
  })
  await server.chats.prepare("/repo/button")
  expect(reads, "Подключение выбирает набор инструментов по подтверждённому типу").toBe(1)
  const key = await assignmentKey(server, "/repo/button")
  expect(await (await server.scopedMcp(scopedRequest(key, {}))).json())
    .toMatchObject({path: ".", description: "Button",
      verification: {status: "confirmed", type: "Component", revision: "verified"}})
  expect(reads, "Предметное чтение отдельно проверяет актуальный отчёт").toBe(2)
  expect((await server.scopedMcp(scopedRequest(key, {path: "repo/button-other"}))).status).toBe(403)
  expect(reads, "Чужой адрес не читает отчёт до проверки полномочий").toBe(2)
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
  expect(f.connections[0]!.config, "Модель и мышление определяет адаптер, приложение ограничивает собственные средства исполнения")
    .toMatchObject({"features.shell_tool": false, "features.unified_exec": false, "skills.include_instructions": false, project_doc_max_bytes: 0, web_search: "disabled"})
  expect(f.connections[0]!.config).not.toHaveProperty("model")
  expect(f.connections[0]!.config).not.toHaveProperty("model_reasoning_effort")
  expect(f.connections[0]!.mode).toBe("read-only")
  expect(f.connections[0]!.mcpServers).toEqual([])
  expect(f.prompts()).toBe(0)
})
