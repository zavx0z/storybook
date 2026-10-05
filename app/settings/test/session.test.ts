import {expect, test} from "bun:test"
import {mkdtemp, rm, mkdir, writeFile} from "node:fs/promises"
import {createHash} from "node:crypto"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSettings from "../index"
import createSessions, {type StorybookChatSession} from "@zavx0z/storybook-chat-session"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"

async function fixture() {
  const project = await mkdtemp(join(tmpdir(), "chat-execution-"))
  const settings = createSettings({project})
  let starts = 0
  let configDelay = 0
  const changes: string[] = []
  const subject = {address: "/", label: "Project", cwd: project, type: "Project" as const}
  const nativeOptions = (model: string, level: string): StorybookTechAcp.Output["configOptions"] => [
    {id: "native-model", name: "Модель", category: "model", type: "select", currentValue: model, options: [{value: "a", name: "A"}, {value: "b", name: "B"}]},
    {id: "native-thought", name: "Мышление", category: "thought_level", type: "select", currentValue: level, options: model === "a" ? [{value: "low", name: "Low"}, {value: "high", name: "High"}] : [{value: "medium", name: "Medium"}]},
  ]
  const input: StorybookChatSession.Input = {
    directory: () => join(project, "meta/chat"), resolve: () => subject,
    resolveExecution: value => settings.resolve(value),
    saveExecutorSelection: value => settings.updateExecutor(value),
    async connect(value) {
      starts += 1
      let options = nativeOptions("a", "high")
      return {
        sessionId: value.previousSessionId ?? "native-codex", capabilities: {},
        get configOptions() { return options },
        async setConfigOption(id, selected) {
          changes.push(`${id}:${selected}`)
          options = id === "native-model" ? nativeOptions(selected, selected === "b" ? "medium" : "low")
            : nativeOptions((options[0] as {currentValue: string}).currentValue, selected)
          await value.onUpdate({sessionUpdate: "config_option_update", configOptions: [...options]})
          if (configDelay > 0) await new Promise(resolve => setTimeout(resolve, configDelay))
          return options
        },
        async prompt() { return {stopReason: "end_turn"} }, async cancel() {}, async dispose() {},
      }
    },
  }
  let sessions = createSessions(input)
  return {project, settings, input, get sessions() { return sessions }, get starts() { return starts }, changes,
    delayUpdates(ms: number) { configDelay = ms },
    async reopen() {
      await sessions.dispose()
      sessions = createSessions(input)
    },
    async dispose() {
      await sessions.dispose()
      await rm(project, {recursive: true, force: true})
    },
  }
}

test("чтение не запускает ACP, model применяется до нового thought_level и override беседы переживает restart", async () => {
  const f = await fixture()
  try {
    const initial = await f.settings.read()
    await f.settings.update({...initial, general: {connectionId: "codex", model: "b", thoughtLevel: "medium"}})
    expect((await f.sessions.read("/")).execution?.effective).toEqual({connectionId: "codex", model: "b", thoughtLevel: "medium"})
    expect(f.starts).toBe(0)
    const prepared = await f.sessions.prepare("/")
    expect(f.changes).toEqual(["native-model:b"])
    expect(prepared.settings?.map(option => option.value)).toEqual(["b", "medium"])
    await f.sessions.configure("/", "native-model", "a")
    await f.sessions.configure("/", "native-thought", "low")
    await f.reopen()
    expect((await f.sessions.read("/")).execution).toMatchObject({selection: {model: "a", thoughtLevel: "low"}, sources: {model: "session", thoughtLevel: "session"}})
    expect(f.starts).toBe(1)
    expect((await f.sessions.prepare("/")).settings?.map(option => option.value)).toEqual(["a", "low"])
    expect(f.changes.at(-1)).toBe("native-thought:low")
  } finally { await f.dispose() }
})

test("недоступная модель явно отклоняется до prompt, отключённое подключение сохраняет чтение истории", async () => {
  const f = await fixture()
  try {
    const config = await f.settings.read()
    const next = await f.settings.update({...config, general: {connectionId: "codex", model: "missing"}})
    expect((await f.sessions.read("/")).execution?.effective.model).toBe("missing")
    expect(f.starts).toBe(0)
    await expect(f.sessions.prepare("/")).rejects.toThrow("недоступна")
    expect(f.changes).toEqual([])
    await f.settings.update({...next, general: {connectionId: "codex"}, connections: [{id: "codex", provider: "codex", label: "Codex", enabled: false}]})
    expect((await f.sessions.history("/")).total).toBe(0)
    expect((await f.sessions.read("/")).execution?.connections[0]?.enabled).toBe(false)
    const before = f.starts
    await expect(f.sessions.prepare("/")).rejects.toThrow("отключено")
    expect(f.starts).toBe(before)
  } finally { await f.dispose() }
})

test("legacy native сохраняет неизвестные настройки при появлении новых defaults", async () => {
  const f = await fixture()
  try {
    const directory = join(f.project, "meta/chat")
    await mkdir(directory, {recursive: true})
    await writeFile(join(directory, `${createHash("sha256").update("/").digest("hex")}.json`), JSON.stringify({schemaVersion: 2, id: "legacy-local", executorId: "legacy-agent", executorLabel: "Основной",
      address: "/", sessionId: "native-existing", cwd: f.project, timeline: [], pending: [], historyComplete: true, status: "idle", error: null}))
    const config = await f.settings.read()
    await f.settings.update({...config, general: {connectionId: "codex", model: "b", thoughtLevel: "medium"}})
    expect((await f.sessions.read("/")).execution?.effective).toEqual({connectionId: "codex"})
    expect((await f.sessions.prepare("/")).execution).toMatchObject({effective: {connectionId: "codex", model: "a", thoughtLevel: "high"}, sources: {model: "native", thoughtLevel: "native"}})
    expect(f.changes).toEqual([])
    await f.reopen()
    await f.sessions.prepare("/")
    expect(f.changes).toEqual([])
    await f.sessions.configureExecution("/", {scope: "session", selection: {}})
    expect((await f.sessions.read("/")).execution).toMatchObject({effective: {model: "b", thoughtLevel: "medium"}, sources: {model: "general", thoughtLevel: "general"}})
    await f.reopen()
    await f.sessions.prepare("/")
    expect((await f.sessions.read("/")).settings?.map(option => option.value)).toEqual(["b", "medium"])
  } finally { await f.dispose() }
})

test("выбор агента сохраняется после удаления его первой беседы, session override остаётся независимым", async () => {
  const f = await fixture()
  try {
    const agent = await f.sessions.create({address: "/", label: "Разработчик"})
    const target = {address: "/", executorId: agent.executorId}
    await f.sessions.configureExecution(target, {scope: "executor", selection: {model: "b"}})
    const session = await f.sessions.createSession(target)
    const selected = {...target, sessionId: session.id}
    expect((await f.sessions.read(selected)).execution?.effective.model).toBe("b")
    await f.sessions.configureExecution(selected, {scope: "session", selection: {model: "a"}})
    await f.sessions.deleteSession({...target, sessionId: agent.id})
    await f.reopen()
    expect(await f.settings.readExecutor({subject: f.input.resolve("/"), executorId: agent.executorId})).toEqual({model: "b"})
    expect((await f.sessions.read(selected)).execution?.effective.model).toBe("a")
    await f.sessions.configureExecution(selected, {scope: "session", selection: {}})
    expect((await f.sessions.read(selected)).execution?.effective.model).toBe("b")
    expect(f.starts).toBe(0)
  } finally { await f.dispose() }
})

test("очистка override возвращает подтверждённый native baseline и не выдаёт прежний выбор за default", async () => {
  const f = await fixture()
  try {
    await f.sessions.prepare("/")
    await f.sessions.configureExecution("/", {scope: "session", selection: {model: "b", thoughtLevel: "medium"}})
    expect((await f.sessions.read("/")).settings?.map(option => option.value)).toEqual(["b", "medium"])
    await f.sessions.configureExecution("/", {scope: "session", selection: {}})
    expect((await f.sessions.read("/")).settings?.map(option => option.value)).toEqual(["a", "high"])
    expect((await f.sessions.read("/")).execution).toMatchObject({selection: {}, effective: {model: "a", thoughtLevel: "high"}, sources: {model: "native", thoughtLevel: "native"}})
    expect(f.changes).toEqual(["native-model:b", "native-model:a", "native-thought:high"])
  } finally { await f.dispose() }
})

test("частичный отказ model/effort не сохраняет invalid override и отключает изменённый transport", async () => {
  const f = await fixture()
  try {
    await f.sessions.prepare("/")
    f.delayUpdates(300)
    await expect(f.sessions.configureExecution("/", {scope: "session", selection: {model: "b", thoughtLevel: "high"}})).rejects.toThrow("недоступна")
    expect((await f.sessions.read("/")).execution?.selection).toEqual({})
    expect((await f.sessions.read("/")).capabilities).toBeNull()
    await f.reopen()
    expect((await f.sessions.prepare("/")).settings?.map(option => option.value)).toEqual(["a", "high"])
    expect(f.changes).toEqual(["native-model:b"])
  } finally { await f.dispose() }
})

test("выбор агента не меняется во время исполнения его другой беседы", async () => {
  const f = await fixture()
  const started = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const nativeConnect = f.input.connect
  const sessions = createSessions({...f.input, async connect(value) {
    const connection = await nativeConnect(value)
    return {...connection, async prompt() {
      started.resolve()
      await finish.promise
      return {stopReason: "end_turn" as const}
    }}
  }})
  try {
    const agent = await sessions.create({address: "/", label: "Агент"})
    const target = {address: "/", executorId: agent.executorId}
    const other = await sessions.createSession(target)
    await sessions.prompt({...target, sessionId: other.id}, "Работа", "active")
    await started.promise
    await expect(sessions.configureExecution(target, {scope: "executor", selection: {model: "b"}})).rejects.toThrow("всех бесед")
    expect(await f.settings.readExecutor({subject: f.input.resolve("/"), executorId: agent.executorId})).toEqual({})
  } finally {
    finish.resolve()
    await sessions.dispose()
    await f.dispose()
  }
})
