import {expect, test} from "bun:test"
import {mkdtemp, readdir, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import createSessions, {type StorybookChatSession} from "../index"

test("Session корзина переживает restart, восстанавливает ту же историю и provider identity; purge отдельный", async () => {
  const directory = await mkdtemp(join(tmpdir(), "session-trash-"))
  const previous: (string | undefined)[] = []
  let prompts = 0
  const input: StorybookChatSession.Input = {directory: () => directory, resolve: address => ({address, label: "P", cwd: directory}),
    async connect(input) {
      previous.push(input.previousSessionId)
      return {sessionId: "original-provider", capabilities: {}, configOptions: [], async setConfigOption() {return []},
        async prompt() {prompts++; return {stopReason: "end_turn"}}, async cancel() {}, async dispose() {}}
    },
  }
  let sessions = createSessions(input)
  try {
    const agent = await sessions.create({address: "/", label: "Агент"})
    const target = {address: "/", executorId: agent.executorId}
    const chat = await sessions.createSession(target, "Сохранить беседу")
    const selected = {...target, sessionId: chat.sessionId}
    await sessions.prepare(selected)
    const history = await sessions.history(selected)
    await sessions.deleteSession(selected)
    expect((await sessions.listSessions(target)).some(item => item.id === chat.id)).toBe(false)
    expect((await sessions.listDeletedSessions(target)).find(item => item.id === chat.id)).toMatchObject({sessionLabel: "Сохранить беседу", recoverable: true})
    await sessions.deleteSession(selected)
    await sessions.dispose()
    sessions = createSessions(input)
    expect((await sessions.listDeletedSessions(target))).toHaveLength(1)
    expect((await sessions.restoreSession(selected)).id).toBe(chat.id)
    expect((await sessions.restoreSession(selected)).id).toBe(chat.id)
    expect((await sessions.history(selected)).total).toBe(history.total)
    expect((await sessions.listDeletedSessions(target))).toEqual([])
    expect(prompts).toBe(0)
    await sessions.prepare(selected)
    expect(previous).toEqual([undefined, "original-provider"])
    await expect(sessions.purgeSession(selected)).rejects.toThrow("не найдена")
    await sessions.deleteSession(selected)
    await expect(sessions.restoreSession({...selected, executorId: "00000000-0000-4000-8000-000000000001"})).rejects.toThrow("не найдена")
    await sessions.purgeSession(selected)
    await sessions.purgeSession(selected)
    expect((await sessions.listDeletedSessions(target))).toEqual([])
    await expect(sessions.restoreSession(selected)).rejects.toThrow("без возможности восстановления")
    expect((await readdir(directory)).some(name => name.endsWith(`.${chat.id}.json`))).toBe(false)
    expect(prompts).toBe(0)
  } finally {await sessions.dispose(); await rm(directory, {recursive: true, force: true})}
})
