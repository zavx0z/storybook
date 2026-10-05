import {expect, spyOn, test} from "bun:test"
import {randomUUID} from "node:crypto"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSessions from "../index"
import {Archive, openArchive} from "../src/archive"
import {chatFile} from "../src/storage"

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test.each([false, true])("параллельные list/read/prepare используют один writer и один provider для durable pending; additional=%s", async additional => {
  const directory = await mkdtemp(join(tmpdir(), "chat-concurrent-recovery-"))
  const executorId = randomUUID()
  const id = randomUUID()
  const file = chatFile(directory, "/", additional ? executorId : undefined, additional ? id : undefined)
  const archive = await openArchive(file, {id, executorId, executorLabel: "Агент", address: "/", pending: ["user:one", "user:two"], historyComplete: true, status: "idle", error: null})
  await archive.commit(undefined, [
    {type: "append", item: {id: "user:one", origin: "local", kind: "message", role: "user", content: [{type: "text", text: "Первая"}]}},
    {type: "append", item: {id: "user:two", origin: "local", kind: "message", role: "user", content: [{type: "text", text: "Вторая"}]}},
  ])
  await archive.dispose()
  let connections = 0
  const prompts: unknown[] = []
  const completion = Promise.withResolvers<void>()
  const sessions = createSessions({
    directory: () => directory,
    resolve: address => ({address, label: address, cwd: directory}),
    async connect(input) {
      connections += 1
      expect(input.localSessionId).toBe(id)
      return {
        sessionId: "single-provider", capabilities: {}, configOptions: [],
        async setConfigOption() { return [] },
        async prompt(content) {
          prompts.push(content)
          await completion.promise
          return {stopReason: "end_turn"}
        },
        async cancel() { completion.resolve() }, async dispose() { completion.resolve() },
      }
    },
  })
  const target = {address: "/", executorId, sessionId: id}
  try {
    const results = await Promise.allSettled([
      sessions.list("/"), sessions.list("/"), sessions.read(target), sessions.read(target),
      sessions.listSessions(target), sessions.listSessions(target), sessions.prepare(target), sessions.prepare(target),
    ])
    for (const result of results.slice(0, 6)) expect(result.status, result.status === "rejected" ? String(result.reason?.stack ?? result.reason) : "Чтение успешно").toBe("fulfilled")
    for (const result of results.slice(6)) {
      if (result.status === "rejected") expect(result.reason.message).toBe("Дождитесь завершения текущего ответа")
    }
    for (let index = 0; index < 100 && prompts.length < 1; index++) await pause(5)
    expect(connections).toBe(1)
    expect(prompts).toEqual(["Первая"])
    completion.resolve()
    for (let index = 0; index < 100 && (prompts.length < 2 || (await sessions.read(target)).status !== "idle"); index++) await pause(5)
    expect(prompts).toEqual(["Первая", "Вторая"])
    expect(connections).toBe(1)
    expect((await sessions.read(target)).pending).toEqual([])
    const history = await sessions.history(target)
    const turns = await Promise.all(history.items.filter(item => item.kind === "turn").map(item => sessions.historyItem(target, item.id)))
    expect(turns.map(item => item.entry).filter(item => item.kind === "turn" && item.state === "started")).toHaveLength(2)
    expect(turns.map(item => item.entry).filter(item => item.kind === "turn" && item.state === "completed")).toHaveLength(2)
  } finally {
    await sessions.dispose()
    await rm(directory, {recursive: true, force: true})
  }
})

test("параллельные idle summaries не создают writer и не подключают provider", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-concurrent-idle-"))
  const executorId = randomUUID()
  const id = randomUUID()
  const archive = await openArchive(chatFile(directory, "/"), {id, executorId, executorLabel: "Агент", address: "/", pending: [], historyComplete: true, status: "idle", error: null})
  await archive.commit(undefined)
  await archive.dispose()
  let connections = 0
  const sessions = createSessions({
    directory: () => directory,
    resolve: address => ({address, label: address, cwd: directory}),
    async connect() {
      connections += 1
      throw new Error("Idle read не подключает provider")
    },
  })
  const writes = spyOn(Archive.prototype, "commit")
  try {
    const target = {address: "/", executorId, sessionId: id}
    await Promise.all([sessions.list("/"), sessions.list("/"), sessions.listSessions(target), sessions.listSessions(target), sessions.read(target)])
    expect(writes.mock.calls).toHaveLength(0)
    expect(connections).toBe(0)
  } finally {
    writes.mockRestore()
    await sessions.dispose()
    await rm(directory, {recursive: true, force: true})
  }
})
