import {expect, spyOn, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import createSessions from "../index"
import {Archive, openArchive} from "../src/archive"
import {chatFile} from "../src/storage"

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "chat-durability-"))
  let prompts = 0
  const sessions = createSessions({
    directory: () => directory,
    resolve: address => ({address, label: address, cwd: directory}),
    async connect() {
      return {sessionId: "native", capabilities: {}, configOptions: [],
        async setConfigOption() {return []},
        async prompt() {prompts++; return {stopReason: "end_turn"}},
        async cancel() {}, async dispose() {},
      }
    },
  })
  return {directory, sessions, prompts: () => prompts,
    async close() {try {await sessions.dispose()} finally {await rm(directory, {recursive: true, force: true})}}}
}
async function settle(sessions: ReturnType<typeof createSessions>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await sessions.read("/")
    if (state.status === "idle" || state.status === "failed") return state
    await Bun.sleep(5)
  }
  throw new Error("Беседа не завершилась")
}

test("canonical user и pending принимаются единственным commit; отказ не оставляет orphan", async () => {
  const f = await fixture()
  const original = Archive.prototype.commit
  const spy = spyOn(Archive.prototype, "commit").mockImplementation(function(this: Archive, metadata, mutations = []) {
    const user = mutations.find(mutation => mutation.type === "append" && mutation.item.id === "user:atomic")
    if (user) {
      expect(metadata?.pending).toContain("user:atomic")
      return Promise.reject(new Error("disk unavailable"))
    }
    return original.call(this, metadata, mutations)
  })
  try {
    await expect(f.sessions.prompt("/", "Задача", "atomic")).rejects.toThrow("disk unavailable")
    expect((await f.sessions.history("/")).items).toEqual([])
    expect((await f.sessions.read("/")).pending).toEqual([])
    expect(f.prompts()).toBe(0)
    spy.mockRestore()
    await f.sessions.prompt("/", "Задача", "atomic")
    expect((await settle(f.sessions)).status).toBe("idle")
    expect(f.prompts()).toBe(1)
  } finally {spy.mockRestore(); await f.close()}
})

test("повтор запроса восстанавливает unstarted orphan, completed request не повторяется", async () => {
  const f = await fixture()
  const archive = await openArchive(chatFile(f.directory, "/"), {id: "orphan", executorId: "executor", executorLabel: "Agent",
    address: "/", pending: [], historyComplete: true, status: "idle", error: null})
  await archive.commit(undefined, [{type: "append", item: {id: "user:orphan", origin: "local", kind: "message", role: "user", content: [{type: "text", text: "Задача"}]}}])
  await archive.dispose()
  try {
    await f.sessions.prompt("/", "Задача", "orphan")
    await settle(f.sessions)
    expect(f.prompts()).toBe(1)
    await f.sessions.prompt("/", "Задача", "orphan")
    await Bun.sleep(5)
    expect(f.prompts()).toBe(1)
    expect((await f.sessions.history("/")).items.filter(item => item.id === "user:orphan")).toHaveLength(1)
  } finally {await f.close()}
})

test("отказ terminal commit освобождает turn; следующий запрос и dispose доступны", async () => {
  const f = await fixture()
  const original = Archive.prototype.commit
  let fail = true
  const spy = spyOn(Archive.prototype, "commit").mockImplementation(function(this: Archive, metadata, mutations = []) {
    if (fail && mutations.some(mutation => mutation.type === "append" && mutation.item.kind === "turn" && mutation.item.state === "completed")) {
      fail = false
      return Promise.reject(new Error("terminal unavailable"))
    }
    return original.call(this, metadata, mutations)
  })
  try {
    await f.sessions.prompt("/", "Первый", "first")
    const failed = await settle(f.sessions)
    expect(failed.status).toBe("failed")
    expect(failed.error).toContain("terminal unavailable")
    await f.sessions.prompt("/", "Второй", "second")
    expect((await settle(f.sessions)).status).toBe("idle")
    expect(f.prompts()).toBe(2)
  } finally {spy.mockRestore(); await f.close()}
})
