import {afterEach, expect, test} from "bun:test"
import {mkdtemp, readdir, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createChatSessions from "../index"
import type {StorybookChatSession} from "../contract"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function fixture(connect: StorybookChatSession.Input["connect"]) {
  const root = await mkdtemp(join(tmpdir(), "storybook-chat-"))
  cleanup.push(() => rm(root, {recursive: true, force: true}))
  const directory = join(root, "chats")
  const input: StorybookChatSession.Input = {
    directory: () => directory,
    resolve(address) {
      if (!["/", "/button", "/input"].includes(address)) throw new Error("Неизвестный адрес")
      return {address, label: address, cwd: root}
    },
    connect,
  }
  const chats = createChatSessions(input)
  cleanup.push(() => chats.dispose())
  return {chats, input, directory}
}

async function settled(chats: StorybookChatSession.Output, address: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await chats.read(address)
    if (value.status === "idle" || value.status === "failed") return value
    await Bun.sleep(5)
  }
  throw new Error("Беседа не завершилась")
}

test("чтение адресов не запускает агента и не создаёт пустые истории", async () => {
  let connections = 0
  const {chats, directory} = await fixture(async () => { connections++; throw new Error("unexpected") })
  const button = await chats.read("/button")
  const input = await chats.read("/input")
  expect(button.id).not.toBe(input.id)
  expect((await chats.read("/button")).id).toBe(button.id)
  expect(connections).toBe(0)
  await expect(readdir(directory)).rejects.toThrow()
  await expect(chats.read("/foreign")).rejects.toThrow("Неизвестный адрес")
})

test("два turn сохраняют разные ответы, повтор запроса не дублирует отправку, восстановление использует прежнюю ACP-сессию", async () => {
  let connections = 0
  let prompts = 0
  const previous: (string | undefined)[] = []
  const {chats, input} = await fixture(async options => {
    connections++
    previous.push(options.previousSessionId)
    return {
      sessionId: "native-session",
      capabilities: {},
      configOptions: [],
      async setConfigOption() { throw new Error("Настройки не предоставлены этим исполнителем") },
      async prompt(text) {
        prompts++
        options.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: `Ответ: ${text}`}})
        return {stopReason: "end_turn"}
      },
      async cancel() {},
      async dispose() {},
    }
  })
  await chats.prompt("/button", "Один", "request-1")
  await settled(chats, "/button")
  await chats.prompt("/button", "Один", "request-1")
  await chats.prompt("/button", "Два", "request-2")
  const done = await settled(chats, "/button")
  expect(done.messages.map(message => [message.role, message.text])).toEqual([
    ["user", "Один"], ["assistant", "Ответ: Один"], ["user", "Два"], ["assistant", "Ответ: Два"],
  ])
  expect(connections).toBe(1)
  expect(prompts).toBe(2)
  await chats.dispose()
  const restored = createChatSessions(input)
  cleanup.push(() => restored.dispose())
  expect((await restored.read("/button")).messages).toEqual(done.messages)
  expect((await restored.read("/button")).id).toBe(done.id)
  expect((await restored.read("/button")).executorId).toBe(done.executorId)
  await restored.prompt("/button", "Три", "request-3")
  await settled(restored, "/button")
  expect(previous).toEqual([undefined, "native-session"])
})

test("отписка не отменяет работу, отмена касается только своей беседы", async () => {
  const finish = new Map<string, () => void>()
  const cancelled: string[] = []
  const {chats} = await fixture(async options => ({
    sessionId: options.subject.address,
    capabilities: {},
    configOptions: [],
    async setConfigOption() { throw new Error("Настройки не предоставлены этим исполнителем") },
    prompt: () => new Promise(resolve => { finish.set(options.subject.address, () => resolve({stopReason: "cancelled"})) }),
    async cancel() { cancelled.push(options.subject.address); finish.get(options.subject.address)?.() },
    async dispose() { finish.get(options.subject.address)?.() },
  }))
  const unsubscribe = await chats.subscribe("/button", () => {})
  await chats.prompt("/button", "Первый", "a")
  await chats.prompt("/input", "Второй", "b")
  while (finish.size < 2) await Bun.sleep(5)
  unsubscribe()
  expect(cancelled).toEqual([])
  await chats.cancel("/button")
  expect((await settled(chats, "/button")).status).toBe("idle")
  expect((await chats.read("/input")).status).toBe("running")
  expect(cancelled).toEqual(["/button"])
  finish.get("/input")!()
  await settled(chats, "/input")
})

test("разрешение связано с беседой и принимает только вариант исполнителя", async () => {
  let permission: unknown
  const {chats} = await fixture(async options => ({
    sessionId: "permission-session",
    capabilities: {},
    configOptions: [],
    async setConfigOption() { throw new Error("Настройки не предоставлены этим исполнителем") },
    async prompt() {
      permission = await options.onPermission({sessionId: "permission-session", toolCall: {
        toolCallId: "tool-1", title: "Проверить Button", status: "pending",
      }, options: [{optionId: "decline", name: "Отклонить", kind: "reject_once"}]})
      return {stopReason: "end_turn"}
    },
    async cancel() {},
    async dispose() {},
  }))
  await chats.prompt("/button", "Проверь", "permission-1")
  let state = await chats.read("/button")
  while (state.permissions.length === 0) { await Bun.sleep(5); state = await chats.read("/button") }
  const id = state.permissions[0]!.id
  await expect(chats.permission("/input", id, "decline")).rejects.toThrow()
  await expect(chats.permission("/button", id, "allow")).rejects.toThrow()
  await chats.permission("/button", id, "decline")
  const done = await settled(chats, "/button")
  expect(permission).toEqual({outcome: {outcome: "selected", optionId: "decline"}})
  expect(done.permissions).toEqual([])
})
