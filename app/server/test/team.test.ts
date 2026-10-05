import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {createChatServer} from "../src/chat"
import type {StorybookPackageGraphRead} from "@zavx0z/storybook-package-graph-read"

const cleanup: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "storybook-team-"))
  cleanup.push(() => rm(root, {recursive: true, force: true}))
  for (const path of ["a/child", "b"]) await mkdir(join(root, path), {recursive: true})
  const nodes = [
    {id: "a", parentId: null, urlPath: "/a", source: {path: join(root, "a")}, childIds: ["child"]},
    {id: "child", parentId: "a", urlPath: "/a/child", source: {path: join(root, "a/child")}, childIds: []},
    {id: "b", parentId: null, urlPath: "/b", source: {path: join(root, "b")}, childIds: []},
  ].map(node => ({...node, kind: "directory", label: node.id, packageId: node.id}))
  const received: {cwd: string, content: unknown}[] = []
  const chat = createChatServer({
    project: root, projectName: () => "Project", toolRoot: root, origin: () => "http://localhost",
    graph: () => ({nodes} as unknown as StorybookPackageGraphRead.Input),
    entries: () => nodes.map(node => ({path: node.urlPath.slice(1), description: node.label, parent: node.parentId})),
    async connect(input) {
      return {sessionId: crypto.randomUUID(), capabilities: {}, configOptions: [],
        async prompt(content) {
          received.push({cwd: input.cwd, content})
          return {stopReason: "end_turn"}
        },
        async setConfigOption() { return [] }, async cancel() {}, async dispose() {},
      }
    },
  })
  cleanup.push(() => chat.dispose())
  const source = await chat.chats.create({address: "/a", label: "Разработчик"})
  const peer = await chat.chats.create({address: "/a", label: "Тестировщик"})
  const parent = await chat.chats.create({address: "/", label: "Координатор"})
  const child = await chat.chats.create({address: "/a/child", label: "Специалист ребёнка"})
  const other = await chat.chats.create({address: "/b", label: "Другая команда"})
  const assignment = await chat.environment.assignExecutor({executorId: source.executorId, address: source.address})
  const call = async (name: string, args = {}) => {
    const response = await chat.environment.handle(new Request("http://localhost/api/environment", {
      method: "POST", headers: {authorization: `Bearer ${assignment.token}`}, body: JSON.stringify({name, arguments: args}),
    }))
    return {status: response.status, body: await response.json()}
  }
  return {root, chat, source, peer, parent, child, other, received, call}
}

test("один вход среды находит только своих специалистов, родителя и детей и сохраняет сообщение точному получателю", async () => {
  const f = await fixture()
  const list = await f.call("team.list")
  expect(list.status).toBe(200)
  expect(list.body.result.executors.map((item: {executorId: string}) => item.executorId).sort())
    .toEqual([f.peer.executorId, f.parent.executorId, f.child.executorId].sort())
  expect(list.body.result.executors).toContainEqual(expect.objectContaining({relation: "peers", label: "Тестировщик"}))
  const denied = await f.call("team.send", {address: "/b", executorId: f.other.executorId, text: "Вне области"})
  expect(denied.status).toBe(403)
  expect((await f.chat.chats.read({address: "/b", executorId: f.other.executorId})).messages).toEqual([])
  const sent = await f.call("team.send", {address: "/a", executorId: f.peer.executorId, text: "Проверь результат"})
  expect(sent.status).toBe(200)
  expect(sent.body.result).toMatchObject({accepted: true, address: "/a", executorId: f.peer.executorId})
  const target = {address: "/a", executorId: f.peer.executorId}
  for (let attempt = 0; attempt < 100 && f.received.length === 0; attempt++) await Bun.sleep(5)
  expect(f.received).toHaveLength(1)
  expect(f.received[0]!.cwd).toBe(join(f.root, "a"))
  const message = (await f.chat.chats.read(target)).messages.find(item => item.role === "user")!
  expect(JSON.parse(message.text)).toEqual({from: {address: "/a", executorId: f.source.executorId, label: "Разработчик"}, message: "Проверь результат"})
  expect((await f.chat.chats.read({address: "/a", executorId: f.source.executorId})).messages).toEqual([])
  const spoofed = await f.call("team.send", {address: "/a", executorId: f.peer.executorId, text: "Подмена", from: "другой"})
  expect(spoofed.status).toBe(400)
})

test("внешнее полномочие Project использует тот же инструмент для всей организации", async () => {
  const f = await fixture()
  const token = "c".repeat(43)
  const call = (name: string, args = {}) => f.chat.environment.request(new Request("http://localhost/api/environment", {
    method: "POST", headers: {authorization: `Bearer ${token}`}, body: JSON.stringify({name, arguments: args}),
  }), {origin: "http://localhost", controlToken: token})
  const list = await (await call("team.list")).json()
  expect(list.result.executors).toContainEqual(expect.objectContaining({executorId: f.other.executorId, address: "/b"}))
  expect(JSON.stringify(list)).not.toContain(token)
  const sent = await call("team.send", {address: "/b", executorId: f.other.executorId, text: "Задача разработчика среды"})
  expect(sent.status).toBe(200)
  const target = {address: "/b", executorId: f.other.executorId}
  const message = (await f.chat.chats.read(target)).messages.find(item => item.role === "user")!
  expect(JSON.parse(message.text).from).toEqual({address: "/", executorId: "developer:project", label: "Разработчик Project"})
})
