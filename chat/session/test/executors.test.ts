import {afterEach, expect, test} from "bun:test"
import {createHash, randomUUID} from "node:crypto"
import {mkdirSync} from "node:fs"
import {mkdtemp, readdir, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSessions, {type StorybookChatSession} from "../index"

type Sessions = StorybookChatSession.Output
type Target = Parameters<Sessions["read"]>[0]
type Snapshot = Awaited<ReturnType<Sessions["read"]>>
type Connection = Parameters<StorybookChatSession.Input["connect"]>[0]
type Response = Awaited<ReturnType<Awaited<ReturnType<StorybookChatSession.Input["connect"]>>["prompt"]>>
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function fixture(onPrompt?: (text: string, input: Connection) => Promise<Response | void>) {
  const directory = await mkdtemp(join(tmpdir(), "chat-executors-"))
  cleanup.push(() => rm(directory, {recursive: true, force: true}))
  const calls: {executorId: string, text: string}[] = []
  const connections: Connection[] = []
  const finishers = new Map<string, () => void>()
  const input: StorybookChatSession.Input = {
    directory: () => directory,
    resolve(address) {
      if (!["/a", "/b", "/c"].includes(address)) throw new Error("Неизвестный предмет")
      return {address, label: `Предмет ${address}`, cwd: directory}
    },
    async connect(value) {
      connections.push(value)
      let model = "one"
      const options = () => [{id: "model", type: "select" as const, category: "model" as const, name: "Model", currentValue: model,
        options: [{value: "one", name: "One"}, {value: "two", name: "Two"}]}]
      return {
        sessionId: value.previousSessionId ?? `native:${value.executorId}`, capabilities: {},
        get configOptions() { return options() },
        async setConfigOption(_id, selected) { model = selected; return options() },
        async prompt(content) {
          const text = typeof content === "string" ? content : content.flatMap(block => block.type === "text" ? [block.text] : []).join("")
          calls.push({executorId: value.executorId, text})
          let cancelled = false
          const stopped = Promise.withResolvers<Response>()
          finishers.set(value.executorId, () => { cancelled = true; stopped.resolve({stopReason: "cancelled"}) })
          const result = await Promise.race([onPrompt?.(text, value) ?? Promise.resolve(undefined), stopped.promise])
          finishers.delete(value.executorId)
          if (cancelled || result?.stopReason === "cancelled") return {stopReason: "cancelled"}
          await value.onUpdate({sessionUpdate: "agent_message_chunk", messageId: `${value.executorId}:${calls.length}`, content: {type: "text", text: `Ответ ${text}`}})
          return result ?? {stopReason: "end_turn"}
        },
        async cancel() { finishers.get(value.executorId)?.() },
        async dispose() { finishers.get(value.executorId)?.() },
      }
    },
  }
  const create = () => {
    const sessions = createSessions(input)
    cleanup.push(() => sessions.dispose())
    return sessions
  }
  const file = (address: string, executorId?: string) => join(directory,
    `${createHash("sha256").update(address).digest("hex")}${executorId === undefined ? "" : `.${executorId}`}.json`)
  return {directory, input, calls, connections, create, file}
}

async function observe(sessions: Sessions, target: Target, matches: (snapshot: Snapshot) => boolean): Promise<Snapshot> {
  const completed = Promise.withResolvers<Snapshot>()
  const unsubscribe = await sessions.subscribe(target, value => { if (matches(value)) completed.resolve(value) })
  try { return await completed.promise } finally { unsubscribe() }
}

const idle = (sessions: Sessions, target: Target) => observe(sessions, target,
  state => state.pending.length === 0 && (state.status === "idle" || state.status === "failed"))

test("именованные исполнители одного предмета имеют независимые history/session/settings, default filename сохраняется", async () => {
  const f = await fixture()
  const sessions = f.create()
  expect(await sessions.list("/a")).toEqual([])
  const base = await sessions.read("/a")
  const author = await sessions.create({address: "/a", label: "Автор"})
  const reviewer = await sessions.create({address: "/a", label: "Ревьюер"})
  expect(new Set([base.executorId, author.executorId, reviewer.executorId]).size).toBe(3)
  expect(f.connections).toEqual([])
  const target = {address: "/a", executorId: author.executorId}
  await sessions.prepare(target)
  await sessions.configure(target, "model", "two")
  await sessions.prepare({address: "/a", executorId: reviewer.executorId})
  expect((await sessions.read(target)).settings?.[0]?.value).toBe("two")
  expect((await sessions.read({address: "/a", executorId: reviewer.executorId})).settings?.[0]?.value).toBe("one")
  await sessions.prompt("/a", "Default", "same-request")
  await idle(sessions, "/a")
  await sessions.prompt(target, "Author", "same-request")
  await idle(sessions, target)
  expect((await sessions.read("/a")).messages.map(message => message.text)).toEqual(["Default", "Ответ Default"])
  expect((await sessions.read(target)).messages.map(message => message.text)).toEqual(["Author", "Ответ Author"])
  const listed = await sessions.list("/a")
  expect(listed.map(value => value.executorLabel).sort()).toEqual(["Автор", "Основной", "Ревьюер"])
  expect(listed.every(value => value.label === "Предмет /a")).toBe(true)
  expect(await Bun.file(f.file("/a")).exists()).toBe(true)
  expect((await Bun.file(f.file("/a")).json()).id).toBe(base.id)
  expect((await Bun.file(f.file("/a", author.executorId)).json()).sessionId).toBe(`native:${author.executorId}`)
  await sessions.dispose()
  const restored = f.create()
  expect((await restored.read(target)).executorLabel).toBe("Автор")
  await restored.prepare(target)
  expect(f.connections.at(-1)?.previousSessionId).toBe(`native:${author.executorId}`)
})

test("точный unknown UUID не создаёт историю; list читает только выбранный адрес", async () => {
  const f = await fixture()
  const sessions = f.create()
  const own = await sessions.create({address: "/a", label: "Исполнитель"})
  await Bun.write(f.file("/b"), "Повреждённый JSON чужого адреса")
  const before = await readdir(f.directory)
  await expect(sessions.read({address: "/a", executorId: randomUUID()})).rejects.toThrow("Исполнитель не найден")
  expect((await sessions.list("/a")).map(value => value.executorId)).toEqual([own.executorId])
  expect(await readdir(f.directory)).toEqual(before)
  expect(f.connections).toEqual([])
})

test.each(["empty", "legacy"])("read/list %s default сохраняют UUID после restart без первого prompt", async kind => {
  const f = await fixture()
  if (kind === "legacy") await Bun.write(f.file("/a"), JSON.stringify({schemaVersion: 1, id: "legacy-stable-chat", address: "/a",
    sessionId: "legacy-native-session", messages: [{id: "old", role: "user", text: "История"}], status: "idle", error: null}))
  const first = f.create()
  const selected = await first.read("/a")
  expect((await first.list("/a"))[0]?.executorId).toBe(selected.executorId)
  await first.dispose()
  const restored = f.create()
  expect((await restored.read({address: "/a", executorId: selected.executorId})).executorId).toBe(selected.executorId)
  expect((await restored.list("/a"))[0]?.id).toBe(selected.id)
  expect(f.connections).toEqual([])
  if (kind === "empty") expect(await readdir(f.directory)).toEqual([])
})

test("busy recipient сохраняет FIFO очередь и повтор requestId не дублирует входящую задачу", async () => {
  const gate = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>()
  const f = await fixture(async text => {
    if (text === "Первый") { entered.resolve(); await gate.promise }
  })
  const sessions = f.create()
  const worker = await sessions.create({address: "/a", label: "Получатель"})
  const target = {address: "/a", executorId: worker.executorId}
  await sessions.prompt(target, "Первый", "first")
  await entered.promise
  const second = await sessions.enqueue(target, "Второй", "second")
  await sessions.enqueue(target, "Второй", "second")
  await sessions.enqueue(target, "Третий", "third")
  expect(second.pending).toEqual(["user:second"])
  expect(f.calls.map(call => call.text)).toEqual(["Первый"])
  const stored = await Bun.file(f.file("/a", worker.executorId)).json()
  expect(stored.pending).toEqual(["user:second", "user:third"])
  expect(stored.timeline.filter((item: {kind: string, id: string}) => item.kind === "message" && item.id === "user:second")).toHaveLength(1)
  expect(stored.queue).toBeUndefined()
  gate.resolve()
  await idle(sessions, target)
  expect(f.calls.map(call => call.text)).toEqual(["Первый", "Второй", "Третий"])
  expect((await sessions.read(target)).timeline.filter(item => item.kind === "turn" && item.state === "started")).toHaveLength(3)
})

test("остановка сервера не повторяет started задачу, но восстанавливает ещё не начатую очередь", async () => {
  const entered = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()
  const f = await fixture(async text => {
    if (text === "Начатая") { entered.resolve(); await gate.promise }
  })
  const first = f.create()
  const worker = await first.create({address: "/a", label: "Получатель"})
  const target = {address: "/a", executorId: worker.executorId}
  await first.enqueue(target, "Начатая", "started")
  await entered.promise
  await first.enqueue(target, "Ожидающая", "pending")
  await first.dispose()
  const before = await Bun.file(f.file("/a", worker.executorId)).json()
  expect(before.pending).toEqual(["user:pending"])
  const restored = f.create()
  await restored.read(target)
  await idle(restored, target)
  expect(f.calls.map(call => call.text)).toEqual(["Начатая", "Ожидающая"])
  expect(f.connections.at(-1)?.previousSessionId).toBe(`native:${worker.executorId}`)
  gate.resolve()
})

test("отказ подключения оставляет недоставленную задачу pending для восстановления", async () => {
  const f = await fixture()
  let fail = true
  const original = f.input.connect
  const first = createSessions({...f.input, async connect(input) {
    if (fail) throw new Error("Адаптер временно недоступен")
    return await original(input)
  }})
  cleanup.push(() => first.dispose())
  const worker = await first.create({address: "/a", label: "Получатель"})
  const target = {address: "/a", executorId: worker.executorId}
  await first.enqueue(target, "Не начатая", "pending")
  const failed = await observe(first, target, state => state.status === "failed")
  expect(failed.pending).toEqual(["user:pending"])
  expect(failed.timeline.some(item => item.kind === "turn" && item.state === "started")).toBe(false)
  await first.dispose()
  fail = false
  const resumed = createSessions({...f.input, connect: original})
  cleanup.push(() => resumed.dispose())
  await resumed.read(target)
  await idle(resumed, target)
  expect(f.calls.map(call => call.text)).toEqual(["Не начатая"])
})

test("перенос одного именованного исполнителя не переносит peers и не активирует сохранённый source JSON", async () => {
  const f = await fixture()
  const sessions = f.create()
  const peer = await sessions.create({address: "/a", label: "Остаётся"})
  const moving = await sessions.create({address: "/a", label: "Переносится"})
  const target = {address: "/a", executorId: moving.executorId}
  await sessions.prompt(target, "История", "before")
  const before = await idle(sessions, target)
  const original = await Bun.file(f.file("/a", moving.executorId)).text()
  const mapping = {executorId: moving.executorId, from: {address: "/a", cwd: f.directory}, to: {address: "/b", cwd: f.directory}}
  const moved = await sessions.relocate(mapping)
  expect(moved).toMatchObject({executorId: moving.executorId, executorLabel: "Переносится", id: before.id, address: "/b"})
  expect(await Bun.file(f.file("/a", moving.executorId)).text()).toBe(original)
  expect((await sessions.list("/a")).map(value => value.executorId)).toEqual([peer.executorId])
  await expect(sessions.read(target)).rejects.toThrow("перенесена")
  const destination = {address: "/b", executorId: moving.executorId}
  await sessions.prompt(destination, "После переноса", "after")
  const after = await idle(sessions, destination)
  expect(after.messages.map(message => message.text)).toEqual(["История", "Ответ История", "После переноса", "Ответ После переноса"])
  expect((await sessions.relocate(mapping))?.messages).toEqual(after.messages)
})

test("durable move intent закрывает source при ошибке copy, повтор завершает перенос без повторного исполнения", async () => {
  const f = await fixture()
  let blockDestination = ""
  const input: StorybookChatSession.Input = {...f.input,
    async environment() {
      return {content: [], async execute() { return [] }, dispose() {
        if (blockDestination) mkdirSync(blockDestination)
      }}
    },
  }
  const sessions = createSessions(input)
  cleanup.push(() => sessions.dispose())
  const worker = await sessions.create({address: "/a", label: "Переносится"})
  const source = {address: "/a", executorId: worker.executorId}
  await sessions.prepare(source)
  const original = await Bun.file(f.file("/a", worker.executorId)).text()
  blockDestination = f.file("/b", worker.executorId)
  const mapping = {executorId: worker.executorId, from: {address: "/a", cwd: f.directory}, to: {address: "/b", cwd: f.directory}}
  await expect(sessions.relocate(mapping)).rejects.toThrow("Перенос ожидает завершения")
  expect(await Bun.file(`${f.file("/a", worker.executorId)}.relocated`).exists()).toBe(true)
  expect(await Bun.file(f.file("/a", worker.executorId)).text()).toBe(original)
  await expect(sessions.read(source)).rejects.toThrow("перенесена")
  expect(await sessions.list("/a")).toEqual([])
  await rm(blockDestination, {recursive: true})
  blockDestination = ""
  await sessions.dispose()
  const restored = createSessions(input)
  cleanup.push(() => restored.dispose())
  const moved = await restored.relocate(mapping)
  expect(moved?.executorId).toBe(worker.executorId)
  expect(moved?.address).toBe("/b")
  expect(f.calls).toEqual([])
  await expect(restored.read(source)).rejects.toThrow("перенесена")
})

test("повтор старого mapping не оживляет исполнителя, уже перенесённого дальше", async () => {
  const f = await fixture()
  const sessions = f.create()
  const worker = await sessions.create({address: "/a", label: "Переезжает"})
  const first = {executorId: worker.executorId, from: {address: "/a", cwd: f.directory}, to: {address: "/b", cwd: f.directory}}
  await sessions.relocate(first)
  const next = {executorId: worker.executorId, from: {address: "/b", cwd: f.directory}, to: {address: "/c", cwd: f.directory}}
  await sessions.relocate(next)
  await expect(sessions.relocate(first)).rejects.toThrow("перенесена дальше")
  expect((await sessions.list("/b"))).toEqual([])
  expect((await sessions.list("/c"))[0]?.executorId).toBe(worker.executorId)
})

test("legacy backup не возвращает перенесённый default в активный list", async () => {
  const f = await fixture()
  const legacyDirectory = join(f.directory, "legacy")
  const filename = createHash("sha256").update("/a").digest("hex")
  await Bun.write(join(legacyDirectory, `${filename}.json`), JSON.stringify({schemaVersion: 1, id: "legacy-moved", address: "/a",
    messages: [{id: "history", role: "user", text: "Старая история"}], status: "idle", error: null}))
  const sessions = createSessions({...f.input, legacyDirectory})
  cleanup.push(() => sessions.dispose())
  const original = await sessions.read("/a")
  await sessions.relocate({from: {address: "/a", cwd: f.directory}, to: {address: "/b", cwd: f.directory}})
  expect(await sessions.list("/a")).toEqual([])
  expect((await sessions.list("/b"))[0]?.executorId).toBe(original.executorId)
  await expect(sessions.read("/a")).rejects.toThrow("перенесена")
})
