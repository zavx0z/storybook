import {afterEach, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdir, mkdtemp, readdir, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSessions, {type StorybookChatSession} from "@zavx0z/storybook-chat-session"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const filename = (address: string) => `${createHash("sha256").update(address).digest("hex")}.json`

async function settled(sessions: StorybookChatSession.Output, address: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await sessions.read(address)
    if (value.status === "idle") return
    if (value.status === "failed") throw new Error(value.error ?? "Ошибка беседы")
    await Bun.sleep(5)
  }
  throw new Error("Беседа не завершилась")
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "storybook-owner-chat-"))
  cleanup.push(() => rm(root, {recursive: true, force: true}))
  for (const owner of ["a", "b"]) await mkdir(join(root, owner))
  const connections: Parameters<StorybookChatSession.Input["connect"]>[0][] = []
  const input: StorybookChatSession.Input = {
    directory: subject => join(subject.cwd, "meta/chat"),
    legacyDirectory: join(root, "chats"),
    resolve(address) {
      if (!["/", "/a", "/b"].includes(address)) throw new Error("Нет владельца")
      return {address, label: address, cwd: address === "/" ? root : join(root, address.slice(1))}
    },
    async connect(value) {
      connections.push(value)
      return {
        sessionId: value.previousSessionId ?? `session:${value.subject.address}`,
        configOptions: [],
        async setConfigOption() { return [] },
        async prompt() {
          value.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: "Ответ"}})
          return {stopReason: "end_turn"}
        },
        async cancel() {},
        async dispose() {},
      }
    },
  }
  const create = () => {
    const sessions = createSessions(input)
    cleanup.push(() => sessions.dispose())
    return sessions
  }
  return {root, input, connections, create, path: (address: string) => join(input.directory(input.resolve(address)), filename(address))}
}

test("Project и две сущности сохраняют истории каждый в своём meta/chat", async () => {
  const f = await fixture()
  const sessions = f.create()
  for (const address of ["/", "/a", "/b"]) await sessions.prompt(address, `Вопрос ${address}`, `request:${address}`)
  for (const address of ["/", "/a", "/b"]) await settled(sessions, address)
  await sessions.dispose()
  for (const address of ["/", "/a", "/b"]) {
    const document = await Bun.file(f.path(address)).json()
    expect(document.address).toBe(address)
    expect(document.messages.map((message: {text: string}) => message.text)).toEqual([`Вопрос ${address}`, "Ответ"])
  }
  await expect(readdir(join(f.root, "chats"))).rejects.toThrow()
  const restored = f.create()
  const before = await Bun.file(f.path("/a")).json()
  expect((await restored.read("/a")).id).toBe(before.id)
  await restored.prepare("/a")
  expect(f.connections.at(-1)?.previousSessionId).toBe(before.sessionId)
})

test("перенос старой истории сохраняет сообщения и sessionId, повтор не затирает новые данные", async () => {
  const f = await fixture()
  const document = {schemaVersion: 1, id: "saved-history", address: "/a", cwd: join(f.root, "a"), sessionId: "saved-session",
    messages: [{id: "old", role: "user", text: "Сохранённый вопрос"}], status: "idle", error: null}
  const legacy = join(f.root, "chats", filename("/a"))
  await Bun.write(legacy, `${JSON.stringify(document, null, 2)}\n`)
  const sessions = f.create()
  expect((await sessions.read("/a")).id).toBe(document.id)
  expect(await Bun.file(f.path("/a")).json()).toEqual(document)
  expect(await Bun.file(legacy).json(), "Прежняя история остаётся доступной для восстановления").toEqual(document)
  expect(f.connections).toHaveLength(0)
  await sessions.prompt("/a", "Новый вопрос", "new")
  await settled(sessions, "/a")
  await sessions.dispose()
  const restored = f.create()
  expect((await restored.read("/a")).messages.map(message => message.text))
    .toEqual(["Сохранённый вопрос", "Новый вопрос", "Ответ"])
  expect(f.connections[0]?.previousSessionId).toBe("saved-session")
})

test("пустое чтение не создаёт meta/chat и не запускает сессию", async () => {
  const f = await fixture()
  await f.create().read("/a")
  expect(await Bun.file(f.path("/a")).exists()).toBeFalse()
  await expect(readdir(join(f.root, "a/meta"))).rejects.toThrow()
  expect(f.connections).toHaveLength(0)
})

test("пакетный перенос историй не загружает агентов и сохраняет неразрешённые адреса", async () => {
  const f = await fixture()
  const legacy = join(f.root, "chats")
  for (const address of ["/a", "/deleted"]) {
    await Bun.write(join(legacy, filename(address)), JSON.stringify({schemaVersion: 1, id: address, address,
      messages: [{id: "1", role: "user", text: "История"}], status: "idle", error: null}))
  }
  const sessions = f.create()
  expect(await sessions.migrateLegacy()).toEqual({migrated: 1, unresolved: ["/deleted"]})
  expect(await sessions.migrateLegacy()).toEqual({migrated: 0, unresolved: ["/deleted"]})
  expect((await Bun.file(f.path("/a")).json()).messages).toEqual([{id: "1", role: "user", text: "История"}])
  expect(await Bun.file(join(legacy, filename("/deleted"))).exists()).toBeTrue()
  expect(f.connections).toHaveLength(0)
})
