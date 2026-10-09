import {expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSessions from "../index"
import type {StorybookChatSession} from "../contract"
import {openArchive, readArchiveMetadata, type ArchiveMetadata, type ArchiveMutation} from "../src/archive"
import {chatFile} from "../src/storage"

async function settled(sessions: StorybookChatSession.Output) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await sessions.read("/")
    if (!state.pending.length && (state.status === "idle" || state.status === "failed")) return state
    await Bun.sleep(5)
  }
  throw new Error("Беседа не завершилась")
}

async function fixture(resolveExecution?: StorybookChatSession.Input["resolveExecution"]) {
  const directory = await mkdtemp(join(tmpdir(), "chat-preparation-"))
  const resumed: (string | undefined)[] = []
  const connections: string[] = []
  const durable = new Set<string>()
  let created = 0
  let prompts = 0
  let uncertain = false
  const owners: StorybookChatSession.Output[] = []
  const create = () => {
    const sessions = createSessions({
      directory: () => directory,
      ...(resolveExecution === undefined ? {} : {resolveExecution}),
      resolve: address => ({address, label: "Chat", cwd: directory}),
      async connect(input) {
        resumed.push(input.previousSessionId)
        connections.push(input.execution.effective.connectionId)
        if (input.previousSessionId !== undefined && !durable.has(input.previousSessionId)) throw new Error("Native conversation is absent")
        const sessionId = input.previousSessionId ?? `prepared:${++created}`
        let model = "a"
        const options = () => [{id: "model", type: "select" as const, category: "model" as const, name: "Model", currentValue: model,
          options: [{value: "a", name: "A"}, {value: "b", name: "B"}]}]
        await input.onUpdate({sessionUpdate: "available_commands_update", availableCommands: []})
        return {sessionId, capabilities: {}, get configOptions() {return options()},
          async setConfigOption(_id, value) {model = value; return options()},
          async prompt() {
            // Проверяется committed source до первого вызова, а не resident state.
            const metadata = await readArchiveMetadata(chatFile(directory, "/"))
            expect(metadata).toMatchObject({sessionId, connectionId: input.execution.effective.connectionId, provider: "codex"})
            expect(metadata?.activeRequest).toBeDefined()
            durable.add(sessionId)
            prompts++
            if (uncertain) throw new Error("Unknown result after dispatch")
            return {stopReason: "end_turn"}
          },
          async cancel() {}, async dispose() {},
        }
      },
    })
    owners.push(sessions)
    return sessions
  }
  return {directory, create, resumed, connections, prompts: () => prompts, created: () => created,
    uncertain() {uncertain = true},
    async seed(historyComplete: boolean, mutations: readonly ArchiveMutation[] = []) {
      const metadata: ArchiveMetadata = {id: "local-chat", executorId: "executor", executorLabel: "Agent", address: "/",
        sessionId: "never-prompted", connectionId: "codex", executionBaseline: {model: "a"},
        executionSelection: {model: "b"}, pending: [], historyComplete, status: "idle", error: null}
      const archive = await openArchive(chatFile(directory, "/"), metadata)
      await archive.commit(metadata, mutations)
      await archive.dispose()
    },
    async close() {try {for (const owner of owners) await owner.dispose()} finally {await rm(directory, {recursive: true, force: true})}},
  }
}

test("prepare → dispose → prepare сохраняет выбор модели без ссылки на временный native handle", async () => {
  const f = await fixture()
  try {
    const first = f.create()
    const original = await first.prepare("/")
    await first.configure("/", "model", "b")
    await first.dispose()
    expect((await readArchiveMetadata(chatFile(f.directory, "/")))?.sessionId).toBeUndefined()
    const restored = await f.create().prepare("/")
    expect(restored.id).toBe(original.id)
    expect(restored.settings?.[0]?.value).toBe("b")
    expect(restored.history.total).toBe(2)
    expect(f.resumed).toEqual([undefined, undefined])
    expect(f.prompts()).toBe(0)
  } finally {await f.close()}
})

test("prepare → dispose → первый prompt закрепляет native identity до dispatch и затем восстанавливает её", async () => {
  const f = await fixture()
  try {
    const first = f.create()
    await first.prepare("/")
    await first.dispose()
    const second = f.create()
    await second.prompt("/", "Первый вопрос", "first")
    expect((await settled(second)).status).toBe("idle")
    await second.dispose()
    await f.create().prepare("/")
    expect(f.resumed).toEqual([undefined, undefined, "prepared:2"])
    expect(f.prompts()).toBe(1)
  } finally {await f.close()}
})

test("legacy preparation-only архив сохраняет локальную identity, events и выбранную модель", async () => {
  const f = await fixture()
  try {
    await f.seed(true, [{type: "append", item: {id: "commands", origin: "live", kind: "event",
      update: {sessionUpdate: "available_commands_update", availableCommands: []}}}])
    const sessions = f.create()
    const state = await sessions.prepare("/")
    expect(state.id).toBe("local-chat")
    expect(state.settings?.[0]?.value).toBe("b")
    expect((await sessions.history("/")).items.some(item => item.id === "commands")).toBeTrue()
    expect(f.resumed).toEqual([undefined])
    expect(f.prompts()).toBe(0)
  } finally {await f.close()}
})

test("неполная пустая история сохраняет native reference и не заменяет неудачный resume новой беседой", async () => {
  const f = await fixture()
  try {
    await f.seed(false)
    await expect(f.create().prepare("/")).rejects.toThrow("Native conversation is absent")
    expect((await readArchiveMetadata(chatFile(f.directory, "/")))?.sessionId).toBe("never-prompted")
    expect(f.resumed).toEqual(["never-prompted"])
    expect(f.created()).toBe(0)
  } finally {await f.close()}
})

test.each(["message", "turn", "tool", "unknown-event"] as const)("legacy %s сохраняет native reference без свежего fallback", async kind => {
  const f = await fixture()
  try {
    const item: Extract<ArchiveMutation, {type: "append"}>["item"] = kind === "message"
      ? {id: "sent", origin: "local", kind: "message", role: "user", content: [{type: "text", text: "Сохранить"}]}
      : kind === "turn" ? {id: "started", origin: "local", kind: "turn", requestId: "sent", state: "started"}
      : kind === "tool" ? {id: "tool", origin: "live", kind: "tool", toolCallId: "tool", call: {sessionUpdate: "tool_call", toolCallId: "tool", title: "Tool", status: "completed"}, updates: []}
      : {id: "unknown", origin: "live", kind: "event", update: {sessionUpdate: "usage_update", used: 1, size: 100}}
    await f.seed(true, [{type: "append", item}])
    await expect(f.create().prepare("/")).rejects.toThrow("Native conversation is absent")
    expect(f.resumed).toEqual(["never-prompted"])
    expect(f.created()).toBe(0)
  } finally {await f.close()}
})

test("неопределённый первый prompt сохраняет reference и не отправляется повторно после restart", async () => {
  const f = await fixture()
  try {
    f.uncertain()
    const first = f.create()
    await first.prompt("/", "Один раз", "uncertain")
    expect((await settled(first)).status).toBe("failed")
    await first.dispose()
    const second = f.create()
    await second.prepare("/")
    await second.prompt("/", "Один раз", "uncertain")
    await Bun.sleep(10)
    expect(f.resumed).toEqual([undefined, "prepared:1"])
    expect(f.prompts()).toBe(1)
  } finally {await f.close()}
})


test("смена подключения до первого prompt освобождает временный handle; после dispatch native связь закреплена", async () => {
  const f = await fixture(async ({selection, pinnedConnectionId}) => ({
    ...(pinnedConnectionId === undefined ? {} : {pinnedConnectionId}),
    selection,
    executorSelection: {},
    effective: {connectionId: pinnedConnectionId ?? selection.connectionId ?? "codex"},
    sources: {connectionId: selection.connectionId === undefined ? "general" : "session"},
    connections: [
      {id: "codex", provider: "codex", label: "First", enabled: true},
      {id: "alternate", provider: "codex", label: "Second", enabled: true},
    ],
  }))
  try {
    const sessions = f.create()
    await sessions.prepare("/")
    await sessions.configureExecution("/", {scope: "session", selection: {connectionId: "alternate"}})
    await sessions.prompt("/", "Первый вопрос", "selected")
    expect((await settled(sessions)).status).toBe("idle")
    expect(f.connections).toEqual(["codex", "alternate"])
    expect(f.resumed).toEqual([undefined, undefined])
    await expect(sessions.configureExecution("/", {scope: "session", selection: {connectionId: "codex"}})).rejects.toThrow("Подключение существующей native сессии отличается")
    expect(f.prompts()).toBe(1)
  } finally {await f.close()}
})
