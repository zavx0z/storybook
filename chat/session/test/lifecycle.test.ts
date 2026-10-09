import {expect, spyOn, test} from "bun:test"
import {mkdtemp, readdir, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSessions from "../index"
import {Archive} from "../src/archive"

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Контроль, cold reads и жизненный цикл проверяются независимо от browser. */
test("idle ACP освобождается, history и list не запускают provider, новая задача возобновляет sessionId", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-lifecycle-"))
  let connected = 0
  let released = 0
  const resumes: (string | undefined)[] = []
  const sessions = createSessions({
    directory: () => directory,
    resolve: address => ({address, label: address, cwd: directory}),
    idleConnectionMs: 10,
    maxInactiveSessions: 2,
    async connect(input) {
      connected += 1
      resumes.push(input.previousSessionId)
      return {
        sessionId: "durable-session", capabilities: {}, configOptions: [],
        async setConfigOption() { return [] },
        async prompt() {
          await input.onUpdate({sessionUpdate: "agent_message_chunk", messageId: `answer:${connected}`, content: {type: "text", text: "Ответ"}})
          return {stopReason: "end_turn"}
        },
        async cancel() {},
        async dispose() { released += 1 },
      }
    },
  })
  try {
    await sessions.prepare("/")
    await sessions.prompt("/", "Первый вопрос", "first")
    for (let index = 0; index < 100 && (await sessions.read("/")).status !== "idle"; index++) await pause(5)
    await pause(30)
    expect(released).toBe(1)
    const disposal = spyOn(Archive.prototype, "dispose")
    try {
      for (let index = 0; index < 20; index++) await sessions.read(`/subject-${index}`)
      expect(disposal.mock.calls.length).toBeGreaterThanOrEqual(18)
    } finally { disposal.mockRestore() }
    const before = await sessions.read("/")
    expect(before).not.toHaveProperty("timeline")
    expect(before).not.toHaveProperty("messages")
    await sessions.history("/")
    await sessions.list("/")
    expect(connected).toBe(1)
    await sessions.prompt("/", "Продолжи", "resume")
    for (let index = 0; index < 100 && (await sessions.read("/")).status !== "idle"; index++) await pause(5)
    expect(connected).toBe(2)
    expect(resumes).toEqual([undefined, "durable-session"])
    expect((await sessions.history("/")).items.some(item => item.kind === "message" && item.role === "assistant")).toBeTrue()
    expect((await readdir(directory)).filter(name => name.endsWith(".json"))).toHaveLength(1)
  } finally {
    await sessions.dispose()
    await rm(directory, {recursive: true, force: true})
  }
})

test("provider slots ограничены и активная работа переживает последнюю отписку", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-slots-"))
  let active = 0
  let peak = 0
  const completions: (() => void)[] = []
  const sessions = createSessions({
    directory: () => directory,
    resolve: address => ({address, label: address, cwd: directory}),
    maxConnections: 2,
    idleConnectionMs: 10,
    async connect() {
      active += 1
      peak = Math.max(peak, active)
      const done = Promise.withResolvers<void>()
      completions.push(() => done.resolve())
      return {
        sessionId: `session:${completions.length}`, capabilities: {}, configOptions: [],
        async setConfigOption() { return [] },
        async prompt() {
          await done.promise
          return {stopReason: "end_turn"}
        },
        async cancel() { done.resolve() },
        async dispose() {
          done.resolve()
          active -= 1
        },
      }
    },
  })
  try {
    const off = await sessions.subscribe("/one", () => {})
    await sessions.prompt("/one", "Первая", "one")
    off()
    await sessions.prompt("/two", "Вторая", "two")
    await sessions.prompt("/three", "Третья", "three")
    await pause(30)
    expect(active).toBe(2)
    expect((await sessions.read("/one")).status).toBe("running")
    completions[0]!()
    for (let index = 0; index < 100 && completions.length < 3; index++) await pause(5)
    expect(completions).toHaveLength(3)
    expect(peak).toBe(2)
    completions.forEach(done => done())
  } finally {
    await sessions.dispose()
    await rm(directory, {recursive: true, force: true})
  }
})
