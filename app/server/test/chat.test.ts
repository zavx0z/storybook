import {afterEach, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createChatServer} from "../src/chat"
import createJournal from "@zavx0z/storybook-app-server-requests"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"
import type {StorybookAppKnowledge} from "@zavx0z/storybook-app-knowledge"

const releases: (() => Promise<void>)[] = []
afterEach(async () => { for (const release of releases.splice(0).reverse()) await release() })

async function fixture(
  configOptions: StorybookTechAcp.Output["configOptions"] = [],
  readType?: StorybookAppKnowledge.Input[1]["entries"][number]["readType"],
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
    project, projectName: () => "Project", toolRoot: project,
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

const scopedRequest = (key: string, input: object) => new Request("http://127.0.0.1:12345/api/environment", {
  method: "POST", headers: {authorization: `Bearer ${key}`, "content-type": "application/json"}, body: JSON.stringify({name: "knowledge.read", arguments: input}),
})

test("вызовы двух агентов разделяются по источнику и одновременно попадают в общий журнал", async () => {
  const {server, connections, journal} = await fixture()
  await server.chats.prepare("/repo/button")
  await server.chats.prepare("/repo/button-other")
  expect(connections.every(connection => connection.mcpServers.length === 0)).toBeTrue()
  const keys = await Promise.all(["/repo/button", "/repo/button-other"].map(address => assignmentKey(server, address)))
  await server.environment.handle(scopedRequest(keys[0]!, {}))
  await server.environment.handle(scopedRequest(keys[0]!, {path: "./repo/button-other"}))
  await server.environment.handle(scopedRequest(keys[1]!, {}))
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
    "Каждое чтение знаний записывает canonical команду общего окружения").toBeTrue()
  expect(first[0]?.agentId, "Источник журнала совпадает с устойчивой identity исполнителя беседы")
    .toBe((await server.chats.read("/repo/button")).executorId)
  for (const key of keys) expect(JSON.stringify(journal.read())).not.toContain(key)
})

test("общие правила остаются доступными переходами от root адресного чата", async () => {
  const {server, connections} = await fixture([], undefined, true)
  await server.chats.prepare("/repo/button")
  const key = await assignmentKey(server, "/repo/button")
  const root = (await (await server.environment.handle(scopedRequest(key, {}))).json()).result
  const rules = root.children.find((child: {path: string}) => child.path === "./rules/storybook/package/reader")
  expect(rules).toBeDefined()
  expect(root.path).toBe(".")
  expect(root).not.toHaveProperty("rules")
  const rule = (await (await server.environment.handle(scopedRequest(key, {path: rules.path}))).json()).result
  expect(rule.children).toEqual([{description: "Contract", path: "./rules/storybook/package/reader/contract"}])
  expect((await server.environment.handle(scopedRequest(key, {path: rule.children[0].path}))).status).toBe(200)
  expect((await server.environment.handle(scopedRequest(key, {path: "storybook/package/reader"}))).status).toBe(403)
})

test("пустые arguments knowledge.read открывают назначенный предмет, прямой чужой адрес запрещён", async () => {
  const {server, connections} = await fixture()
  await server.chats.prompt("/repo/button", "Привет", "1")
  while (connections.length === 0) await Bun.sleep(5)
  const key = await assignmentKey(server, "/repo/button")
  const root = await server.environment.handle(scopedRequest(key, {}))
  expect(root.status).toBe(200)
  expect((await root.json()).result).toEqual({description: "Button", path: ".", children: [
    {description: "Part", path: "./part"},
    {path: "./meta/notes", description: "Заметки назначенного владельца из meta/notes"},
    {path: "./rules/documents", description: "Основания и нормативные документы Storybook"},
    {path: "./instructions", description: "Действующие агентские правила по цепочке Project и назначенного предмета"},
  ]})
  const part = (await (await server.environment.handle(scopedRequest(key, {path: "part"}))).json()).result
  expect(part).toEqual({description: "Part", path: "./part", children: [{description: "Deep", path: "./part/deep"}]})
  expect((await server.environment.handle(scopedRequest(key, {path: part.children[0].path}))).status).toBe(200)
  expect((await server.environment.handle(scopedRequest(key, {path: "deep"}))).status).toBe(403)
  expect((await (await server.environment.handle(scopedRequest(key, {}))).json()).result).toEqual({description: "Button", path: ".", children: [
    {description: "Part", path: "./part"},
    {path: "./meta/notes", description: "Заметки назначенного владельца из meta/notes"},
    {path: "./rules/documents", description: "Основания и нормативные документы Storybook"},
    {path: "./instructions", description: "Действующие агентские правила по цепочке Project и назначенного предмета"},
  ]})
  expect((await server.environment.handle(scopedRequest(key, {path: "repo/button/part"}))).status).toBe(403)
  expect((await server.environment.handle(scopedRequest(key, {path: "repo/button-other"}))).status).toBe(403)
  expect((await server.environment.handle(scopedRequest(key, {path: "repo"}))).status).toBe(403)
  expect((await server.environment.handle(scopedRequest("invalid", {}))).status).toBe(401)
  await server.dispose()
  expect((await server.environment.handle(scopedRequest(key, {}))).status).toBe(401)
})

test("подписка передаёт историю и её закрытие не отменяет чат", async () => {
  const {server} = await fixture()
  const snapshots: unknown[] = []
  const release = await server.subscribe("/repo/button", snapshot => snapshots.push(snapshot))
  expect(snapshots).toHaveLength(1)
  expect(snapshots[0]).toMatchObject({address: "/repo/button", status: "idle", history: {total: 0}})
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
  expect((await (await server.environment.handle(scopedRequest(key, {}))).json()).result)
    .toMatchObject({path: ".", description: "Button",
      verification: {status: "confirmed", type: "Component", revision: "verified"}})
  expect(reads, "Предметное чтение отдельно проверяет актуальный отчёт").toBe(2)
  expect((await server.environment.handle(scopedRequest(key, {path: "repo/button-other"}))).status).toBe(403)
  expect(reads, "Чужой адрес не читает отчёт до проверки полномочий").toBe(2)
})


test("HTTP настройки используют ту же ACP-сессию без отправки сообщения", async () => {
  const f = await fixture([{id: "selected-model", category: "model", type: "select", name: "Model", currentValue: "a",
    options: [{value: "a", name: "A"}, {value: "b", name: "B"}]}])
  const request = (operation: string, values = {}) => f.server.request(new Request(`http://127.0.0.1:12345/api/browser/chat/${operation}`, {
    method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({address: "/repo/button", ...values}),
  }))
  expect(await (await request("prepare")).json()).toMatchObject({settings: [{id: "selected-model", value: "a"}], history: {total: 0}, configuring: false})
  expect(await (await request("configure", {id: "selected-model", value: "b"})).json()).toMatchObject({settings: [{value: "b"}], history: {total: 0}})
  expect(f.connections).toHaveLength(1)
  expect(f.connections[0]!.config, "Модель и мышление определяет адаптер, приложение ограничивает собственные средства исполнения")
    .toMatchObject({"features.shell_tool": false, "features.unified_exec": false, "skills.include_instructions": false, project_doc_max_bytes: 0, web_search: "disabled"})
  expect(f.connections[0]!.config).not.toHaveProperty("model")
  expect(f.connections[0]!.config).not.toHaveProperty("model_reasoning_effort")
  expect(f.connections[0]!.mode).toBe("read-only")
  expect(f.connections[0]!.mcpServers).toEqual([])
  expect(f.prompts()).toBe(0)
})

test("HTTP разделяет compact состояние, страницы заголовков и отдельные тела с identity guard", async () => {
  const {server, connections} = await fixture()
  const target = {address: "/repo/button"}
  await server.chats.prepare(target.address)
  for (let index = 0; index < 100; index++) await connections[0]!.onUpdate({
    sessionUpdate: "agent_message_chunk", messageId: `message:${index}`, content: {type: "text", text: `Запись ${index} ${"x".repeat(1000)}`},
  })
  const request = (operation: string, values = {}) => server.request(new Request(`http://localhost/api/browser/chat/${operation}`, {
    method: "POST", body: JSON.stringify({...target, ...values}),
  }))
  const snapshot = await (await request("session")).json()
  expect(snapshot.history.total).toBe(100)
  expect(snapshot).not.toHaveProperty("timeline")
  expect(snapshot).not.toHaveProperty("messages")
  expect(JSON.stringify(snapshot).length).toBeLessThan(4096)
  const page = await (await request("history", {query: {around: 0, limit: 32}})).json()
  expect(page.items).toHaveLength(32)
  expect(JSON.stringify(page)).not.toContain("x".repeat(100))
  expect(page.after).not.toBeNull()
  const first = page.items[0]
  const body = await (await request("history-item", {id: first.id, chatId: snapshot.id})).json()
  expect(body.entry.content).toEqual([{type: "text", text: `Запись 0 ${"x".repeat(1000)}`}])
  expect(body.entry.updates ?? []).toEqual([])
  const evidence = await (await request("history-evidence", {id: first.id, query: {around: 0}})).json()
  expect(evidence.items).toHaveLength(1)
  expect(evidence.items[0].update.messageId).toBe("message:0")
  expect((await request("history", {chatId: "stale"})).status).toBe(409)
  await expect(request("history", {query: {limit: 100000}})).rejects.toThrow("граница")
  await expect(request("history", {query: {before: 10, after: 20}})).rejects.toThrow("один cursor")
  expect((await request("history")).headers.get("cache-control")).toBe("no-store")
})

test("две сессии агента разделяют полномочия, получают только свои события и освобождаются независимо", async () => {
  const {server} = await fixture()
  const agent = await server.chats.read("/repo/button")
  const events = [[], []] as unknown[][]
  const leases = await Promise.all(["first-session", "second-session"].map((sessionId, index) => server.environment.acquireSession({
    executorId: agent.executorId, executorLabel: agent.executorLabel, address: agent.address, sessionId,
  }, event => {events[index]!.push(event)})))
  const first = leases[0]!
  const second = leases[1]!
  expect(first.token).toBe(second.token)
  expect((await first.execute(scopedRequest(first.token, {}))).status).toBe(200)
  expect(events[0]).toHaveLength(2)
  expect(events[1]).toHaveLength(0)
  first.dispose()
  expect((await second.execute(scopedRequest(second.token, {}))).status).toBe(200)
  expect(events[0]).toHaveLength(2)
  expect(events[1]).toHaveLength(2)
  second.dispose()
  expect((await server.environment.handle(scopedRequest(second.token, {}))).status).toBe(401)
})
