import {afterEach, expect, spyOn, test} from "bun:test"
import {mkdtemp, readdir, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import createSessions, {type StorybookChatSession} from "../index"
import {inspect} from "./inspect"
import {Archive, openArchive} from "../src/archive"
import {createHash} from "node:crypto"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {for (const close of cleanups.splice(0).reverse()) await close()})
type Snapshot = Awaited<ReturnType<StorybookChatSession.Output["read"]>>

async function until(sessions: StorybookChatSession.Output, matches: (value: Snapshot) => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await sessions.read("/")
    if (matches(value)) return value
    await Bun.sleep(5)
  }
  throw new Error("Состояние не достигнуто")
}

async function fixture(mode: "ask" | "scoped-autonomous" = "ask", host = false, stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" = "end_turn", commandData = "data") {
  const directory = await mkdtemp(join(tmpdir(), "permission-history-"))
  cleanups.push(() => rm(directory, {recursive: true, force: true}))
  let effects = 0
  let prompts = 0
  let reply: unknown
  const permissionCancellation = new AbortController()
  const request = {sessionId: "provider", toolCall: {toolCallId: "tool", title: "Действие", rawInput: {command: "complete-command", cwd: directory},
    locations: [{path: join(directory, "file.txt")}], _meta: {opaque: "retained"}},
    options: [{optionId: "once", name: "Один раз", kind: "allow_once" as const},
      {optionId: "deny", name: "Отклонить", kind: "reject_once" as const}], _meta: {version: 1}}
  const input: StorybookChatSession.Input = {
    directory: () => directory,
    resolve: address => ({address, label: "P", cwd: directory}),
    async resolveExecution() {return {selection: {}, executorSelection: {}, effective: {connectionId: "codex", approvalMode: mode},
      sources: {connectionId: "general", approvalMode: "general"}, connections: [{id: "codex", provider: "codex", label: "Codex", enabled: true}]}},
    ...(host ? {async environment(input: Parameters<NonNullable<StorybookChatSession.Input["environment"]>>[0]) {
      return {content: [], async execute(command: Parameters<typeof input.authorize>[1], signal: AbortSignal) {
        await input.authorize("host-tool", command, signal)
        effects += 1
        return [{type: "text" as const, text: "Выполнено"}]
      }, dispose() {}}
    }} : {}),
    async connect(input) {
      return {sessionId: "provider", capabilities: {}, configOptions: [], async setConfigOption() {return []},
        async prompt() {
          prompts += 1
          if (stopReason !== "end_turn") return {stopReason}
          if (host) {
            if (prompts === 1) await input.onUpdate({sessionUpdate: "agent_message_chunk", content: {type: "text", text: JSON.stringify({name: "filesystem.write", arguments: {path: "file.txt", content: commandData}})}})
          } else reply = await input.onPermission(request, permissionCancellation.signal)
          return {stopReason: "end_turn"}
        }, async cancel() {}, async dispose() {},
      }
    },
  }
  const sessions = createSessions(input)
  cleanups.push(() => sessions.dispose())
  return {sessions, input, directory, request, permissionCancellation, get reply() {return reply}, get effects() {return effects}}
}

test("полный запрос сохраняется до публикации; повтор решения идемпотентен, конфликт и stale hash отклоняются", async () => {
  const f = await fixture()
  await f.sessions.prompt("/", "Начать", "request")
  const pending = await until(f.sessions, value => value.permissions.length === 1)
  expect(pending.activity).toBe("waiting_for_approval")
  const permission = pending.permissions[0]!
  expect(permission.request).toEqual(f.request)
  expect(permission.toolCall).toBeUndefined()
  expect(permission.detailsId).toBe(`permission:${permission.id}:request`)
  expect(Buffer.byteLength(JSON.stringify(pending.permissions))).toBeLessThanOrEqual(64 * 1024)
  const persisted = await inspect(f.sessions, "/")
  expect(persisted.timeline.find(item => item.kind === "permission" && item.phase === "requested")).toMatchObject({request: f.request})
  await expect(f.sessions.permission("/", permission.id, "once", "0".repeat(64))).rejects.toThrow("изменился")
  await Promise.all([f.sessions.permission("/", permission.id, "once", permission.requestHash), f.sessions.permission("/", permission.id, "once", permission.requestHash)])
  await until(f.sessions, value => value.status === "idle")
  expect(f.reply).toEqual({outcome: {outcome: "selected", optionId: "once"}})
  await expect(f.sessions.permission("/", permission.id, "deny", permission.requestHash)).rejects.toThrow("другое решение")
  const history = await inspect(f.sessions, "/")
  expect(history.timeline.filter(item => item.kind === "permission" && item.phase === "decided")).toHaveLength(1)
})

test.each(["input", "option", "title"] as const)("большой %s сохраняется целиком, но не публикуется и не подтверждается по усечённым условиям", async field => {
  const f = await fixture()
  const full = "Полное условие без усечения ".repeat(8192)
  if (field === "input") f.request.toolCall.rawInput.command = full
  else if (field === "title") f.request.toolCall.title = full
  else f.request.options[0]!.name = full
  const snapshots: Snapshot[] = []
  const stop = await f.sessions.subscribe("/", value => snapshots.push(value))
  try {
    await f.sessions.prompt("/", "Большое действие", `large-${field}`)
    const done = await until(f.sessions, value => value.status === "idle")
    expect(f.reply).toEqual({outcome: {outcome: "cancelled"}})
    expect(done.error).toContain("64 КиБ")
    expect(snapshots.every(value => value.permissions.length === 0)).toBe(true)
    expect(Math.max(...snapshots.map(value => Buffer.byteLength(JSON.stringify(value))))).toBeLessThan(70 * 1024)
    const history = await inspect(f.sessions, "/")
    const request = history.timeline.find(item => item.kind === "permission" && item.phase === "requested")
    expect(request).toMatchObject({request: f.request})
    const decision = history.timeline.find(item => item.kind === "permission" && item.phase === "cancelled")
    expect(decision).toMatchObject({phase: "cancelled", error: expect.stringContaining("64 КиБ")})
    if (request?.kind !== "permission") throw new Error("Нет исходного запроса")
    await expect(f.sessions.permission("/", request.permissionId, "once")).rejects.toThrow("другое решение")
  } finally {stop()}
})

test("большой host запрос не исполняется даже при scoped-autonomous", async () => {
  const f = await fixture("scoped-autonomous", true, "end_turn", "x".repeat(128 * 1024))
  await f.sessions.prompt("/", "Большое host действие", "large-host")
  const done = await until(f.sessions, value => value.status === "failed")
  expect(f.effects).toBe(0)
  expect(done.permissions).toEqual([])
  expect(done.error).toContain("64 КиБ")
})

test("параллельные малые разрешения делят один бюджет snapshot, лишний запрос отменяется", async () => {
  const f = await fixture()
  const sessions = createSessions({...f.input, async connect(input) {
    return {sessionId: "provider", capabilities: {}, configOptions: [], async setConfigOption() {return []},
      async prompt() {
        await Promise.all(Array.from({length: 3}, (_, index) => input.onPermission({...f.request,
          toolCall: {...f.request.toolCall, toolCallId: `tool-${index}`, rawInput: {command: "x".repeat(30_000)}},
        })))
        return {stopReason: "end_turn"}
      }, async cancel() {}, async dispose() {},
    }
  }})
  cleanups.push(() => sessions.dispose())
  await sessions.prompt("/", "Три действия", "parallel-permissions")
  const waiting = await until(sessions, value => value.permissions.length === 2 && value.error?.includes("64 КиБ") === true)
  expect(Buffer.byteLength(JSON.stringify(waiting.permissions))).toBeLessThanOrEqual(64 * 1024)
  for (const request of waiting.permissions) await sessions.permission("/", request.id, "deny")
  await until(sessions, value => value.status === "idle")
  expect((await inspect(sessions, "/")).timeline.filter(item => item.kind === "permission" && item.phase === "cancelled")).toHaveLength(1)
})

test("отмена закрывает pending request и запрещает позднее разрешение", async () => {
  const f = await fixture()
  await f.sessions.prompt("/", "Начать", "cancel")
  const pending = await until(f.sessions, value => value.permissions.length === 1)
  const id = pending.permissions[0]!.id
  await f.sessions.cancel("/")
  await until(f.sessions, value => value.status === "idle")
  expect(f.reply).toEqual({outcome: {outcome: "cancelled"}})
  await expect(f.sessions.permission("/", id, "once")).rejects.toThrow("другое решение")
  expect((await inspect(f.sessions, "/")).timeline.filter(item => item.kind === "permission" && item.phase === "cancelled")).toHaveLength(1)
})

test("отмена provider request удаляет карточку и возвращает cancelled без выбранного разрешения", async () => {
  const f = await fixture()
  await f.sessions.prompt("/", "Начать", "provider-cancel")
  await until(f.sessions, value => value.permissions.length === 1)
  f.permissionCancellation.abort()
  await until(f.sessions, value => value.status === "idle")
  expect(f.reply).toEqual({outcome: {outcome: "cancelled"}})
  expect((await f.sessions.read("/")).permissions).toEqual([])
})

test("отмена во время durable decision не доставляет разрешение исполнителю", async () => {
  const f = await fixture()
  await f.sessions.prompt("/", "Начать", "cancel-during-commit")
  const pending = await until(f.sessions, value => value.permissions.length === 1)
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const original = Archive.prototype.commit
  const spy = spyOn(Archive.prototype, "commit").mockImplementation(async function(this: Archive, metadata, mutations) {
    if (mutations?.some(mutation => mutation.type === "append" && mutation.item.kind === "permission" && mutation.item.phase === "decided")) {
      entered.resolve()
      await release.promise
    }
    return original.call(this, metadata, mutations)
  })
  try {
    const choice = f.sessions.permission("/", pending.permissions[0]!.id, "once")
    await entered.promise
    f.permissionCancellation.abort()
    release.resolve()
    await choice
    await until(f.sessions, value => value.status === "idle")
    expect(f.reply).toEqual({outcome: {outcome: "cancelled"}})
    expect((await inspect(f.sessions, "/")).timeline.filter(item => item.kind === "permission" && item.phase === "cancelled")).toHaveLength(1)
  } finally { release.resolve(); spy.mockRestore() }
})

test("отказ записи решения не выдаёт разрешение и сохраняет возможность отмены", async () => {
  const f = await fixture()
  await f.sessions.prompt("/", "Начать", "failed-decision")
  const pending = await until(f.sessions, value => value.permissions.length === 1)
  const original = Archive.prototype.commit
  const spy = spyOn(Archive.prototype, "commit").mockImplementation(async function(this: Archive, metadata, mutations) {
    if (mutations?.some(mutation => mutation.type === "append" && mutation.item.kind === "permission" && mutation.item.phase === "decided")) throw new Error("disk failure")
    return original.call(this, metadata, mutations)
  })
  try {
    await expect(f.sessions.permission("/", pending.permissions[0]!.id, "once")).rejects.toThrow("disk failure")
    expect(f.reply).toBeUndefined()
    expect((await f.sessions.read("/")).permissions).toHaveLength(1)
  } finally { spy.mockRestore() }
  await f.sessions.cancel("/")
  await until(f.sessions, value => value.status === "idle")
  expect(f.reply).toEqual({outcome: {outcome: "cancelled"}})
})

test("scoped-autonomous исполняет host действие и сохраняет policy decision, native исключение не разрешается автоматически", async () => {
  const host = await fixture("scoped-autonomous", true)
  await host.sessions.prompt("/", "Начать", "host")
  await until(host.sessions, value => value.status === "idle")
  expect(host.effects).toBe(1)
  expect((await inspect(host.sessions, "/")).timeline.find(item => item.kind === "permission" && item.phase === "decided")).toMatchObject({actor: "policy", source: "environment", optionId: "allow-once"})
  const native = await fixture("scoped-autonomous")
  await native.sessions.prompt("/", "Начать", "native")
  const pending = await until(native.sessions, value => value.permissions.length === 1)
  expect(native.reply).toBeUndefined()
  await native.sessions.permission("/", pending.permissions[0]!.id, "deny")
})

test("host действие в ask не происходит до решения и отклонение не даёт эффекта", async () => {
  const f = await fixture("ask", true)
  await f.sessions.prompt("/", "Начать", "host-ask")
  const pending = await until(f.sessions, value => value.permissions.length === 1)
  expect(f.effects).toBe(0)
  await f.sessions.permission("/", pending.permissions[0]!.id, "reject-once")
  await until(f.sessions, value => value.status === "failed")
  expect(f.effects).toBe(0)
})

test.each(["max_tokens", "max_turn_requests", "refusal"] as const)("%s остаётся отличимым незавершённым исходом", async stopReason => {
  const f = await fixture("ask", false, stopReason)
  await f.sessions.prompt("/", "Начать", stopReason)
  const done = await until(f.sessions, value => value.status === "failed")
  expect(done.error).not.toBeNull()
  expect((await inspect(f.sessions, "/")).timeline.find(item => item.kind === "turn" && item.state === "failed")).toMatchObject({stopReason})
})

test("после crash pending permission становится interrupted без повторного запроса или действия", async () => {
  const f = await fixture()
  await f.sessions.prepare("/")
  await f.sessions.dispose()
  const file = join(f.directory, (await readdir(f.directory)).find(name => name.endsWith(".json"))!)
  const header = await Bun.file(file).json()
  const archive = await openArchive(file, header.metadata)
  const requestHash = createHash("sha256").update(JSON.stringify(f.request)).digest("hex")
  await archive.commit({...archive.metadata, status: "running", activeRequest: "lost-turn", pendingPermissions: ["stale"]}, [{type: "append", item: {
    id: "permission:stale:request", origin: "local", kind: "permission", permissionId: "stale", requestId: "lost-turn",
    requestHash, source: "provider", phase: "requested", title: "Действие", request: f.request,
  }}])
  await archive.dispose()
  const restored = createSessions(f.input)
  cleanups.push(() => restored.dispose())
  const value = await restored.read("/")
  expect(value.status).toBe("failed")
  expect(value.permissions).toEqual([])
  expect(f.reply).toBeUndefined()
  expect((await restored.historyItem("/", "permission:stale:decision")).entry).toMatchObject({kind: "permission", phase: "interrupted"})
  await expect(restored.permission("/", "stale", "once", requestHash)).rejects.toThrow("другое решение")
})

test("принудительная остановка освобождает только owned соединение после неподтверждённого cancel", async () => {
  const directory = await mkdtemp(join(tmpdir(), "permission-stop-"))
  const completion = Promise.withResolvers<{stopReason: "cancelled"}>()
  let disposed = 0
  const sessions = createSessions({directory: () => directory, resolve: address => ({address, label: "P", cwd: directory}),
    async connect() {return {sessionId: "stalled", capabilities: {}, configOptions: [], async setConfigOption() {return []},
      prompt: () => completion.promise, async cancel() {}, async dispose() {disposed += 1; completion.resolve({stopReason: "cancelled"})}}},
  })
  try {
    await sessions.prompt("/", "Ждать", "stalled")
    await until(sessions, value => value.status === "running")
    await sessions.cancel("/")
    expect((await sessions.read("/")).activity).toBe("cancelling")
    const stopped = await sessions.stop("/")
    expect(stopped.status).toBe("idle")
    expect(disposed).toBe(1)
  } finally {await sessions.dispose(); await rm(directory, {recursive: true, force: true})}
})
