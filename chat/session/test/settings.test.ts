import {expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import type {TechAcp} from "@tech/acp"
import createSessions from "../index"

test("настройки не запускают prompt; модель обновляет уровни, usage берётся из агента и история сохраняется", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-settings-"))
  let options: TechAcp.Output["configOptions"] = [
    {id: "provider-model", type: "select", category: "model", name: "Model", currentValue: "a", options: [{value: "a", name: "A"}, {value: "b", name: "B"}]},
    {id: "provider-thinking", type: "select", category: "thought_level", name: "Thinking", currentValue: "high", options: [{value: "low", name: "Low"}, {value: "high", name: "High"}]},
  ]
  let input: Parameters<Parameters<typeof createSessions>[0]["connect"]>[0]
  let connections = 0
  let prompts = 0
  const changes: unknown[] = []
  const chats = createSessions({
    directory,
    resolve: address => ({address, label: "Chat", cwd: directory}),
    async connect(value) {
      input = value
      connections += 1
      value.onProgress?.("session")
      return {
        sessionId: "persistent-session",
        get configOptions() { return options },
        async setConfigOption(id, selected) {
          changes.push([id, selected])
          const model = options[0]!
          if (model.type !== "select") throw new Error("Fixture model must be select")
          options = [
            {...model, currentValue: selected},
            {id: "provider-thinking", type: "select", category: "thought_level", name: "Thinking", currentValue: "low", options: [{value: "low", name: "Low"}]},
          ]
          return options
        },
        async prompt() {
          prompts += 1
          await input.onUpdate({sessionUpdate: "usage_update", used: 427000, size: 828000})
          await input.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: "Готово"}})
          return {stopReason: "end_turn"}
        },
        async cancel() {},
        async dispose() {},
      }
    },
  })
  try {
    expect((await chats.read("/")).settings).toEqual([])
    expect(connections).toBe(0)
    const phases: string[] = []
    const stopProgress = await chats.subscribe("/", state => { if (state.progress) phases.push(state.progress) })
    await Promise.all([chats.prepare("/"), chats.prepare("/")])
    stopProgress()
    expect(phases).toContain("Загрузка сессии и доступных моделей…")
    expect((await chats.read("/")).progress).toBeUndefined()
    expect(connections).toBe(1)
    expect(prompts).toBe(0)
    expect((await chats.read("/")).settings).toMatchObject([{id: "provider-model", value: "a"}, {value: "high"}])
    await expect(chats.configure("/", "provider-model", "unavailable")).rejects.toThrow("доступный вариант")
    expect(changes).toEqual([])
    const configured = await chats.configure("/", "provider-model", "b")
    expect(configured.settings).toMatchObject([{value: "b"}, {value: "low", options: [{value: "low"}]}])
    expect(configured.messages).toEqual([])
    expect(configured.usage).toBeNull()
    const done = Promise.withResolvers<void>()
    const unsubscribe = await chats.subscribe("/", state => {
      if (state.status === "idle" && state.messages.length === 2) done.resolve()
    })
    await chats.prompt("/", "Привет", "one")
    await done.promise
    unsubscribe()
    const result = await chats.read("/")
    expect(result.messages.map(message => message.text)).toEqual(["Привет", "Готово"])
    expect(result.usage).toEqual({used: 427000, size: 828000})
    expect(prompts).toBe(1)
    expect(connections).toBe(1)
  } finally {
    await chats.dispose()
    await rm(directory, {recursive: true, force: true})
  }
}, 5000)

test("подготовка настроек публикует этапы и отменяется до первого prompt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-prepare-cancel-"))
  const started = Promise.withResolvers<void>()
  const chats = createSessions({
    directory,
    resolve: address => ({address, label: "Chat", cwd: directory}),
    async connect(input) {
      input.onProgress?.("initialize")
      started.resolve()
      return await new Promise<never>((_, reject) => {
        input.signal.addEventListener("abort", () => reject(input.signal.reason), {once: true})
      })
    },
  })
  try {
    const pending = chats.prepare("/").then(() => null, error => error)
    await started.promise
    expect(await chats.read("/")).toMatchObject({configuring: true, progress: "Подключение к агенту…", messages: []})
    await chats.cancel("/")
    expect((await pending).message).toBe("Подключение отменено")
    expect(await chats.read("/")).toMatchObject({configuring: false, messages: []})
    expect((await chats.read("/")).progress).toBeUndefined()
  } finally {
    await chats.dispose()
    await rm(directory, {recursive: true, force: true})
  }
})
