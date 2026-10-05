import {expect, test} from "bun:test"
import {mkdtemp, readdir, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSessions, {type StorybookChatSession} from "../index"

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test("агент владеет несколькими именованными сессиями, выбор и переименование сохраняются после restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-named-sessions-"))
  const attempts: Parameters<StorybookChatSession.Input["connect"]>[0][] = []
  const input: StorybookChatSession.Input = {
    directory: () => directory,
    resolve: address => ({address, label: address, cwd: directory}),
    async connect(connection) {
      attempts.push(connection)
      return {
        sessionId: `provider:${attempts.length}`, capabilities: {}, configOptions: [],
        async setConfigOption() { return [] },
        async prompt() {
          await connection.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: "Ответ"}})
          return {stopReason: "end_turn"}
        },
        async cancel() {}, async dispose() {},
      }
    },
  }
  let sessions = createSessions(input)
  try {
    const agent = await sessions.create({address: "/", label: "Исследователь"})
    const agentTarget = {address: "/", executorId: agent.executorId}
    const first = await sessions.createSession(agentTarget, "Архитектура")
    const second = await sessions.createSession(agentTarget, "История")
    expect(first.executorId).toBe(second.executorId)
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(first.sessionId).toBe(first.id)
    expect((await sessions.listSessions(agentTarget)).map(item => item.sessionLabel).sort()).toEqual(["Архитектура", "История", "Новая беседа"].sort())
    expect(attempts).toHaveLength(0)
    expect((await sessions.list("/")).find(item => item.executorId === agent.executorId)?.sessionId).toBe(agent.sessionId)
    const selected = {...agentTarget, sessionId: first.sessionId}
    await sessions.renameSession(selected, "Новая архитектура")
    await sessions.prompt(selected, "Прочитай", "selected")
    for (let index = 0; index < 100 && (await sessions.read(selected)).status !== "idle"; index++) await pause(5)
    expect((await sessions.history({...agentTarget, sessionId: second.sessionId})).total).toBe(0)
    await sessions.dispose()
    sessions = createSessions(input)
    expect((await sessions.read(selected)).sessionLabel).toBe("Новая архитектура")
    await sessions.prepare(selected)
    expect(attempts.at(-1)?.previousSessionId).toBe("provider:1")
    await sessions.deleteSession(selected)
    expect((await sessions.listSessions(agentTarget)).map(item => item.sessionId)).not.toContain(first.sessionId)
    expect((await readdir(directory)).some(name => name.endsWith(".deleted"))).toBeTrue()
    await expect(sessions.read(selected)).rejects.toThrow("Сессия не найдена")
    expect((await sessions.list("/")).filter(item => item.executorId === agent.executorId)).toHaveLength(1)
  } finally {
    await sessions.dispose()
    await rm(directory, {recursive: true, force: true})
  }
})

test("удаление active сессии отклоняется и не затрагивает текущий turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-delete-active-"))
  const completion = Promise.withResolvers<void>()
  const sessions = createSessions({
    directory: () => directory,
    resolve: address => ({address, label: address, cwd: directory}),
    async connect() {
      return {
        sessionId: "active", capabilities: {}, configOptions: [],
        async setConfigOption() { return [] },
        async prompt() {
          await completion.promise
          return {stopReason: "end_turn"}
        },
        async cancel() { completion.resolve() }, async dispose() { completion.resolve() },
      }
    },
  })
  try {
    const agent = await sessions.create({address: "/", label: "Агент"})
    const session = await sessions.createSession({address: "/", executorId: agent.executorId}, "Работа")
    const target = {address: "/", executorId: agent.executorId, sessionId: session.sessionId}
    await sessions.prompt(target, "Работай", "active")
    await expect(sessions.deleteSession(target)).rejects.toThrow("Завершите текущую работу")
    expect((await sessions.listSessions(target)).map(item => item.id)).toContain(session.id)
    completion.resolve()
  } finally {
    await sessions.dispose()
    await rm(directory, {recursive: true, force: true})
  }
})

test("auto имя берётся из первого вопроса, manual имя сохраняется и агент переживает удаление всех сессий", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-auto-name-"))
  const sessions = createSessions({
    directory: () => directory,
    resolve: address => ({address, label: address, cwd: directory}),
    async connect() {
      return {sessionId: "auto", capabilities: {}, configOptions: [], async setConfigOption() { return [] }, async prompt() { return {stopReason: "end_turn"} }, async cancel() {}, async dispose() {}}
    },
  })
  try {
    const agent = await sessions.create({address: "/", label: "Агент"})
    const target = {address: "/", executorId: agent.executorId}
    const automatic = await sessions.createSession(target)
    const selected = {...target, sessionId: automatic.sessionId}
    await sessions.prompt(selected, "Проверь полный жизненный цикл больших историй сейчас", "first")
    for (let index = 0; index < 100 && (await sessions.read(selected)).status !== "idle"; index++) await pause(5)
    expect((await sessions.read(selected)).sessionLabel).toBe("Проверь полный жизненный цикл больших историй")
    await sessions.renameSession(selected, "Выбранное имя")
    await sessions.prompt(selected, "Совсем другой вопрос", "second")
    for (let index = 0; index < 100 && (await sessions.read(selected)).status !== "idle"; index++) await pause(5)
    expect((await sessions.read(selected)).sessionLabel).toBe("Выбранное имя")
    await sessions.deleteSession(selected)
    await sessions.deleteSession({...target, sessionId: agent.sessionId})
    expect(await sessions.listSessions(target)).toEqual([])
    expect((await sessions.list("/")).map(item => item.executorId)).toContain(agent.executorId)
    const created = await sessions.createSession(target, "Продолжение")
    expect(created.executorId).toBe(agent.executorId)
    expect((await sessions.read(target)).sessionId).toBe(created.sessionId)
    expect((await sessions.listSessions(target)).map(item => item.sessionLabel)).toEqual(["Продолжение"])
  } finally {
    await sessions.dispose()
    await rm(directory, {recursive: true, force: true})
  }
})

test("durable отметка удаления запрещает восстановление оставшегося после сбоя корпуса", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-delete-tombstone-"))
  const input: StorybookChatSession.Input = {
    directory: () => directory,
    resolve: address => ({address, label: address, cwd: directory}),
    async connect() { throw new Error("Чтение не запускает модель") },
  }
  let sessions = createSessions(input)
  try {
    const agent = await sessions.create({address: "/", label: "Автор"})
    const target = {address: "/", executorId: agent.executorId}
    const selected = await sessions.createSession(target, "Удалённая беседа")
    await sessions.dispose()
    const file = (await readdir(directory)).find(name => name.endsWith(`.${selected.id}.json`))!
    const header = await Bun.file(join(directory, file)).json()
    await Bun.write(join(directory, `${file}.deleted`), JSON.stringify({schemaVersion: 1, metadata: header.metadata}))
    sessions = createSessions(input)
    expect((await sessions.listSessions(target)).map(value => value.id)).not.toContain(selected.id)
    await expect(sessions.read({...target, sessionId: selected.id})).rejects.toThrow("Сессия не найдена")
    expect((await sessions.list("/")).filter(value => value.executorId === agent.executorId)).toHaveLength(1)
  } finally {
    await sessions.dispose()
    await rm(directory, {recursive: true, force: true})
  }
})
