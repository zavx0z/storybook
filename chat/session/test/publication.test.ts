import {inspect, persisted} from "./inspect"
import {afterEach, expect, spyOn, test} from "bun:test"
import {mkdtemp, readFile, readdir, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSessions, {type StorybookChatSession} from "../index"

type Snapshot = Awaited<ReturnType<StorybookChatSession.Output["read"]>>
type ConnectionInput = Parameters<StorybookChatSession.Input["connect"]>[0]
type EnvironmentInput = Parameters<NonNullable<StorybookChatSession.Input["environment"]>>[0]
const cleanups: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "chat-publication-"))
  cleanups.push(() => rm(directory, {recursive: true, force: true}))
  let connection!: ConnectionInput
  let environment!: EnvironmentInput
  const completion = Promise.withResolvers<{stopReason: "end_turn" | "cancelled"}>()
  const started = Promise.withResolvers<void>()
  const sessions = createSessions({
    directory: () => directory,
    resolve: address => ({address, label: "Беседа", cwd: directory}),
    async environment(input) {
      environment = input
      return {content: [{type: "text", text: "Среда"}], async execute() { return [] }, dispose() {}}
    },
    async connect(input) {
      connection = input
      return {sessionId: "publication-session", capabilities: {}, configOptions: [],
        async setConfigOption() { return [] },
        async prompt() { started.resolve(); return completion.promise },
        async cancel() { completion.resolve({stopReason: "cancelled"}) },
        async dispose() { completion.resolve({stopReason: "cancelled"}) },
      }
    },
  })
  cleanups.push(() => sessions.dispose())
  await sessions.prepare("/")
  return {sessions, directory, get connection() { return connection }, get environment() { return environment }, completion, started}
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return
    await pause(5)
  }
  throw new Error("Состояние не достигнуто")
}
function observeClones() {
  const clone = spyOn(globalThis, "structuredClone")
  cleanups.push(() => clone.mockRestore())
  return () => clone.mock.calls.filter(([value]) => value !== null && typeof value === "object"
    && "history" in value && "version" in value).length
}

/** Управляем только debounce: скорость fsync не меняет смысл проверки объединения. */
function holdPublication() {
  const original = globalThis.setTimeout
  const pending = new Map<ReturnType<typeof setTimeout>, () => void>()
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) => {
    const handle = original(callback, delay === 50 ? 60_000 : delay)
    if (delay === 50) pending.set(handle, callback)
    return handle
  }) as typeof setTimeout)
  cleanups.push(() => { for (const handle of pending.keys()) clearTimeout(handle); timer.mockRestore() })
  return () => { for (const [handle, callback] of pending) { clearTimeout(handle); callback() }; pending.clear() }
}

test("поток ACP/replay/environment объединяется до клонирования, read возвращает все дельты и последнюю version", async () => {
  const f = await fixture()
  const flushPublication = holdPublication()
  const snapshots: Snapshot[] = []
  const unsubscribe = await f.sessions.subscribe("/", value => snapshots.push(value))
  cleanups.push(unsubscribe)
  const clones = observeClones()
  const version = snapshots.at(-1)!.version
  for (let index = 0; index < 30; index++) await f.connection.onUpdate({sessionUpdate: "agent_message_chunk", messageId: "live", content: {type: "text", text: `${index},`}})
  await f.connection.onReplay?.({sessionUpdate: "agent_message_chunk", messageId: "replay", content: {type: "text", text: "Восстановленное сообщение"}})
  await f.environment.onUpdate({sessionUpdate: "tool_call", toolCallId: "environment", title: "Чтение", status: "in_progress"})
  await f.environment.onUpdate({sessionUpdate: "tool_call_update", toolCallId: "environment", status: "completed", rawOutput: {ok: true}})
  expect(snapshots).toHaveLength(1)
  expect(clones(), "До публикации нет отброшенных полных snapshots").toBe(0)
  const current = await f.sessions.read("/")
  const history = await inspect(f.sessions, "/")
  expect(current.version).toBe(version + 33)
  expect(history.messages[0]!.text).toBe(Array.from({length: 30}, (_, index) => `${index},`).join(""))
  const message = history.timeline.find(item => item.kind === "message" && item.providerMessageId === "live")
  expect(message?.kind === "message" ? message.updates : []).toHaveLength(30)
  const tool = history.timeline.find(item => item.kind === "tool")
  expect(tool?.kind === "tool" ? tool.updates : []).toHaveLength(2)
  flushPublication()
  await until(() => snapshots.length === 2)
  expect(snapshots[1]).toEqual(current)
  expect(clones(), "Два явных чтения и один объединённый snapshot").toBe(3)
  await pause(70)
  expect(snapshots).toHaveLength(2)
})

test("без слушателей и после последней отписки поток не создаёт snapshots или timers", async () => {
  const f = await fixture()
  const clones = observeClones()
  const timers = spyOn(globalThis, "setTimeout")
  cleanups.push(() => timers.mockRestore())
  await f.connection.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: "Без наблюдателя"}})
  expect(clones()).toBe(0)
  expect(timers.mock.calls.filter(([, delay]) => delay === 50)).toHaveLength(0)
  const snapshots: Snapshot[] = []
  const unsubscribe = await f.sessions.subscribe("/", value => snapshots.push(value))
  expect((await inspect(f.sessions, "/")).messages[0]!.text).toBe("Без наблюдателя")
  await f.connection.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: " и дополнение"}})
  const before = clones()
  unsubscribe()
  await f.connection.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: " после закрытия"}})
  await pause(70)
  expect(clones()).toBe(before)
  expect(snapshots).toHaveLength(1)
  const current = await f.sessions.read("/")
  const history = await inspect(f.sessions, "/")
  expect(current.version).toBe(snapshots[0]!.version + 2)
  expect(history.messages[0]!.text).toBe("Без наблюдателя и дополнение после закрытия")
})

test("permission публикуется после durable request вместе с pending delta без debounce", async () => {
  const f = await fixture()
  const snapshots: Snapshot[] = []
  const unsubscribe = await f.sessions.subscribe("/", value => snapshots.push(value))
  cleanups.push(unsubscribe)
  const clones = observeClones()
  const version = snapshots[0]!.version
  await f.connection.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: "Перед разрешением"}})
  const permission = f.connection.onPermission({sessionId: "publication-session", toolCall: {toolCallId: "tool", title: "Действие"},
    options: [{optionId: "reject", name: "Отклонить", kind: "reject_once"}]})
  for (let attempt = 0; attempt < 100 && snapshots.length < 2; attempt++) await pause(5)
  expect(snapshots).toHaveLength(2)
  expect(clones()).toBe(1)
  expect(snapshots[1]!.version).toBe(version + 2)
  expect((await inspect(f.sessions, "/")).messages[0]!.text).toBe("Перед разрешением")
  expect(snapshots[1]!.permissions).toHaveLength(1)
  await pause(70)
  expect(snapshots).toHaveLength(2)
  await f.sessions.permission("/", snapshots[1]!.permissions[0]!.id, "reject")
  expect(await permission).toEqual({outcome: {outcome: "selected", optionId: "reject"}})
})

test.each(["completed", "cancelled", "failed"] as const)("%s доставляет финальную дельту без debounce и сохраняет prompt completion", async state => {
  const f = await fixture()
  const snapshots: Snapshot[] = []
  const unsubscribe = await f.sessions.subscribe("/", value => snapshots.push(value))
  cleanups.push(unsubscribe)
  await f.sessions.prompt("/", "Задача", "request")
  await f.started.promise
  const before = await f.sessions.read("/")
  const publishedBefore = snapshots.at(-1)!
  await f.connection.onUpdate({sessionUpdate: "agent_message_chunk", messageId: "final", content: {type: "text", text: "Последняя дельта"}})
  const queuedCount = snapshots.length
  expect(snapshots.at(-1)).toEqual(publishedBefore)
  if (state === "completed") f.completion.resolve({stopReason: "end_turn"})
  else if (state === "cancelled") await f.sessions.cancel("/")
  else f.completion.reject(new Error("Отказ исполнителя"))
  await until(() => snapshots.some(value => value.history.total > before.history.total && value.status === (state === "failed" ? "failed" : "idle")))
  expect(snapshots.length).toBeGreaterThan(queuedCount)
  const final = snapshots.at(-1)!
  const finalHistory = await inspect(f.sessions, "/")
  expect(finalHistory.messages.some(message => message.text === "Последняя дельта")).toBeTrue()
  expect(finalHistory.timeline.at(-1)).toMatchObject({kind: "turn", state})
  expect(final.version).toBe(before.version + (state === "cancelled" ? 3 : 2))
  expect(final).toEqual(await f.sessions.read("/"))
  const file = (await readdir(f.directory)).find(name => name.endsWith(".json"))!
  expect((await persisted(join(f.directory, file))).timeline).toEqual(finalHistory.timeline)
  const count = snapshots.length
  await pause(70)
  expect(snapshots).toHaveLength(count)
})

test("dispose снимает pending publication без поздних listeners или snapshots", async () => {
  const f = await fixture()
  const snapshots: Snapshot[] = []
  await f.sessions.subscribe("/", value => snapshots.push(value))
  const clones = observeClones()
  await f.connection.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: "До завершения owner"}})
  await f.sessions.dispose()
  await pause(70)
  expect(snapshots).toHaveLength(1)
  expect(clones()).toBe(0)
})

test("закрытие owner во время начальной подписки не оставляет слушателя или snapshot", async () => {
  const f = await fixture()
  const clones = observeClones()
  let delivered = 0
  const subscription = f.sessions.subscribe("/", () => { delivered += 1 }).then(() => null, error => error)
  await f.sessions.dispose()
  expect((await subscription).message).toBe("Чаты остановлены")
  expect(delivered).toBe(0)
  expect(clones()).toBe(0)
})
