import {afterEach, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdir, mkdtemp, readFile, rm, stat} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createChatSessions, {type StorybookChatSession} from "@storybook-chat/session"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function fixture(connect: StorybookChatSession.Input["connect"]) {
  const root = await mkdtemp(join(tmpdir(), "storybook-chat-relocation-"))
  const oldCwd = join(root, "old")
  const newCwd = join(root, "new")
  const directory = join(root, "chats")
  await mkdir(oldCwd)
  await mkdir(newCwd)
  cleanup.push(() => rm(root, {recursive: true, force: true}))
  let addresses = new Set(["/old"])
  const input: StorybookChatSession.Input = {
    directory,
    resolve(address) {
      if (!addresses.has(address)) throw new Error("Адрес отсутствует в текущем каталоге")
      return {address, label: address, cwd: address === "/old" ? oldCwd : newCwd}
    },
    connect,
  }
  const create = () => {
    const chats = createChatSessions(input)
    cleanup.push(() => chats.dispose())
    return chats
  }
  return {
    root, directory, oldCwd, newCwd, create,
    select(...values: string[]) { addresses = new Set(values) },
    mapping: {from: {address: "/old", cwd: oldCwd}, to: {address: "/new", cwd: newCwd}},
    file(address: string) { return join(directory, `${createHash("sha256").update(address).digest("hex")}.json`) },
  }
}

async function settled(chats: StorybookChatSession.Output, address: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await chats.read(address)
    if (state.status === "idle" || state.status === "failed") return state
    await Bun.sleep(5)
  }
  throw new Error("Беседа не завершилась")
}

const successfulConnect: StorybookChatSession.Input["connect"] = async input => ({
  sessionId: input.previousSessionId ?? "retained-acp-session",
  configOptions: [],
  async setConfigOption() { throw new Error("Настройки не предоставлены этим исполнителем") },
  async prompt(text) {
    input.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: `Ответ: ${text}`}})
    return {stopReason: "end_turn"}
  },
  async cancel() {},
  async dispose() {},
})

test("перенос сохраняет историю, id для черновика и ACP-сессию; повтор не стирает новые сообщения", async () => {
  const calls: {cwd: string; previousSessionId: string | undefined}[] = []
  const f = await fixture(async input => {
    calls.push({cwd: input.subject.cwd, previousSessionId: input.previousSessionId})
    return successfulConnect(input)
  })
  const original = f.create()
  await original.prompt("/old", "Первый", "first")
  const before = await settled(original, "/old")
  await original.dispose()
  f.select("/new")
  const relocated = f.create()
  const moved = await relocated.relocate(f.mapping)
  expect(moved).toMatchObject({id: before.id, address: "/new", messages: before.messages})
  expect(moved?.id, "Browser draft key продолжает использовать прежний chat id").toBe(before.id)
  const target = JSON.parse(await readFile(f.file("/new"), "utf8"))
  expect(target).toMatchObject({id: before.id, address: "/new", cwd: f.newCwd, sessionId: "retained-acp-session"})
  expect(JSON.parse(await readFile(f.file("/old"), "utf8"))).toMatchObject({address: "/old", id: before.id})
  expect(calls).toEqual([{cwd: f.oldCwd, previousSessionId: undefined}])

  await relocated.prompt("/new", "Второй", "second")
  const continued = await settled(relocated, "/new")
  expect(calls).toEqual([
    {cwd: f.oldCwd, previousSessionId: undefined},
    {cwd: f.newCwd, previousSessionId: "retained-acp-session"},
  ])
  expect(continued.messages).toHaveLength(before.messages.length + 2)
  const repeated = await relocated.relocate(f.mapping)
  expect(repeated?.messages).toEqual(continued.messages)
  expect(JSON.parse(await readFile(f.file("/new"), "utf8")).messages).toEqual(continued.messages)
})

test("занятый новый адрес отказывает без изменения обеих историй", async () => {
  const f = await fixture(successfulConnect)
  f.select("/old", "/new")
  const chats = f.create()
  await chats.prompt("/old", "Старый", "old")
  await settled(chats, "/old")
  await chats.prompt("/new", "Новый", "new")
  await settled(chats, "/new")
  await chats.dispose()
  const oldBytes = await readFile(f.file("/old"), "utf8")
  const newBytes = await readFile(f.file("/new"), "utf8")
  const another = f.create()
  await expect(another.relocate(f.mapping)).rejects.toThrow("занят другой беседой")
  expect(await readFile(f.file("/old"), "utf8")).toBe(oldBytes)
  expect(await readFile(f.file("/new"), "utf8")).toBe(newBytes)
})

test("неверный новый cwd не проходит проверку текущего каталога", async () => {
  const f = await fixture(successfulConnect)
  const original = f.create()
  await original.prompt("/old", "Текст", "one")
  await settled(original, "/old")
  await original.dispose()
  f.select("/new")
  const chats = f.create()
  await expect(chats.relocate({...f.mapping, to: {...f.mapping.to, cwd: f.oldCwd}}))
    .rejects.toThrow("не совпадают с текущим каталогом")
  await expect(stat(f.file("/new"))).rejects.toThrow()
})

test("пауза между turn освобождает прежнее ACP-подключение и переводит загруженное состояние", async () => {
  let disposed = 0
  const f = await fixture(async input => ({
    ...await successfulConnect(input),
    async dispose() { disposed += 1 },
  }))
  const chats = f.create()
  await chats.prompt("/old", "Первый", "one")
  const before = await settled(chats, "/old")
  f.select("/new")
  const moved = await chats.relocate(f.mapping)
  expect(moved).toMatchObject({id: before.id, address: "/new", messages: before.messages})
  expect(disposed).toBe(1)
  expect((await chats.read("/new")).id).toBe(before.id)
  await expect(chats.read("/old")).rejects.toThrow("Адрес отсутствует")
})

test("ошибка официального ACP resume сохраняет прежнюю историю и sessionId", async () => {
  const f = await fixture(successfulConnect)
  const original = f.create()
  await original.prompt("/old", "Сохранённое", "first")
  const before = await settled(original, "/old")
  await original.dispose()
  f.select("/new")
  const attempts: (string | undefined)[] = []
  const restored = createChatSessions({
    directory: f.directory,
    resolve: address => ({address, label: address, cwd: f.newCwd}),
    async connect(input) {
      attempts.push(input.previousSessionId)
      throw new Error("ACP resume unavailable")
    },
  })
  cleanup.push(() => restored.dispose())
  await restored.relocate(f.mapping)
  await restored.prompt("/new", "Продолжить", "second")
  const failed = await settled(restored, "/new")
  expect(failed.status).toBe("failed")
  expect(failed.error).toBe("ACP resume unavailable")
  expect([...failed.messages.slice(0, before.messages.length)]).toEqual([...before.messages])
  expect(attempts).toEqual(["retained-acp-session"])
  expect(JSON.parse(await readFile(f.file("/new"), "utf8")).sessionId).toBe("retained-acp-session")
})

test("активный turn запрещает перенос и сохраняет прежний файл", async () => {
  const finish = Promise.withResolvers<{stopReason: "end_turn"}>()
  const f = await fixture(async () => ({
    sessionId: "active-session",
    configOptions: [],
    async setConfigOption() { throw new Error("Настройки не предоставлены этим исполнителем") },
    prompt: () => finish.promise,
    async cancel() { finish.resolve({stopReason: "end_turn"}) },
    async dispose() { finish.resolve({stopReason: "end_turn"}) },
  }))
  f.select("/old", "/new")
  const chats = f.create()
  await chats.prompt("/old", "В работе", "active")
  while ((await chats.read("/old")).status !== "running") await Bun.sleep(5)
  const before = await readFile(f.file("/old"), "utf8")
  await expect(chats.relocate(f.mapping)).rejects.toThrow("Активную беседу")
  expect(await readFile(f.file("/old"), "utf8")).toBe(before)
  await expect(stat(f.file("/new"))).rejects.toThrow()
  finish.resolve({stopReason: "end_turn"})
  await settled(chats, "/old")
})
