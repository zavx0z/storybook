import {expect, test} from "bun:test"
import {chmod, mkdtemp, readFile, rm, unlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSettings from "../index"
import createSessions from "@zavx0z/storybook-chat-session"

const connections = [
  {id: "primary-codex", provider: "codex" as const, label: "Codex", enabled: true},
  {id: "gpu-ollama", provider: "ollama" as const, label: "Ollama GPU", enabled: true,
    endpoint: {url: "http://127.0.0.1:11434", ssh: {host: "ai-srv-origin", user: "inference", port: 22}}},
] as const

async function fixture() {
  const project = await mkdtemp(join(tmpdir(), "execution-providers-"))
  const settings = createSettings({project})
  const subject = {address: "/", label: "Project", cwd: project, type: "Project" as const}
  const executorId = "agent"
  await settings.update({...await settings.read(), connections,
    general: {connectionId: "primary-codex", model: "codex-model", thoughtLevel: "high"}, types: {}})
  return {project, settings, subject, executorId, dispose: () => rm(project, {recursive: true, force: true})}
}

test("локальные подключения с произвольными identity переживают restart и не попадают в переносимый документ", async () => {
  const f = await fixture()
  try {
    expect((await createSettings({project: f.project}).read()).connections).toEqual(connections)
    const portable = await readFile(join(f.project, "meta/settings/execution.json"), "utf8")
    expect(portable).not.toContain("127.0.0.1")
    expect(portable).not.toContain("ai-srv-origin")
    expect(JSON.parse(portable).connections).toBeUndefined()
    expect(JSON.parse(await readFile(join(f.project, ".local/execution-connections.json"), "utf8")).current.connections).toEqual(connections)
  } finally {await f.dispose()}
})

test("смена провайдера на любом уровне сбрасывает прежнюю модель и мышление", async () => {
  const f = await fixture()
  try {
    const base = await f.settings.read()
    await f.settings.update({...base, types: {Project: {connectionId: "gpu-ollama"}}})
    expect((await f.settings.resolve({...f, selection: {}})).effective).toEqual({connectionId: "gpu-ollama"})
    await f.settings.updateExecutor({...f, selection: {connectionId: "primary-codex", model: "other-codex", thoughtLevel: "low"}})
    expect((await f.settings.resolve({...f, selection: {connectionId: "gpu-ollama", model: "qwen"}})).effective).toEqual({connectionId: "gpu-ollama", model: "qwen"})
    await f.settings.updateExecutor({...f, selection: {}})
    const native = await f.settings.resolve({...f, selection: {}, pinnedConnectionId: "primary-codex"})
    expect(native.effective).toEqual({connectionId: "primary-codex", model: "codex-model", thoughtLevel: "high"})
    expect(native.sources).toEqual({connectionId: "native", model: "general", thoughtLevel: "general"})
    await expect(f.settings.resolve({...f, selection: {connectionId: "gpu-ollama"}, pinnedConnectionId: "primary-codex"})).rejects.toThrow("несовместимое восстановление")
  } finally {await f.dispose()}
})

test("явная новая модель сбрасывает унаследованное мышление; явный уровень остаётся проверяемым выбором", async () => {
  const f = await fixture()
  try {
    expect((await f.settings.resolve({...f, selection: {model: "other"}})).effective).toEqual({connectionId: "primary-codex", model: "other"})
    expect((await f.settings.resolve({...f, selection: {model: "other", thoughtLevel: "medium"}})).effective).toEqual({connectionId: "primary-codex", model: "other", thoughtLevel: "medium"})
    expect((await f.settings.resolve({...f, selection: {model: "codex-model"}})).effective.thoughtLevel).toBe("high")
  } finally {await f.dispose()}
})

test("валидация отвергает shell, credentials, port, неизвестные и повторяющиеся подключения", async () => {
  const f = await fixture()
  try {
    const saved = await f.settings.read()
    for (const endpoint of [
      {url: "http://user:secret@example.com"}, {url: "file:///tmp/model"},
      {url: "http://example.com?key=value"}, {url: "http://example.com#fragment"},
      {url: "http://localhost:11434", ssh: {host: "host;uname"}},
      {url: "http://localhost:11434", ssh: {host: "-oProxyCommand=sh"}},
      {url: "http://localhost:11434", ssh: {host: "gpu", user: "root$(whoami)"}},
      {url: "http://localhost:11434", ssh: {host: "gpu", port: 65536}},
      {url: "https://example.com", ssh: {host: "gpu"}},
      {url: "http://localhost:11434", ssh: {host: "gpu", user: "_unsupported"}},
      {url: "http://localhost:11434", ssh: {host: "gpu:22"}},
    ]) {
      await expect(f.settings.update({...saved, connections: [connections[0]!, {...connections[1]!, endpoint}]})).rejects.toThrow()
    }
    await expect(f.settings.update({...saved, connections: [connections[0]!, connections[0]!]})).rejects.toThrow("уникальными")
    await expect(f.settings.update({...saved, general: {connectionId: "missing"}})).rejects.toThrow("Неизвестное")
    await expect(f.settings.updateExecutor({...f, selection: {connectionId: "missing"}})).rejects.toThrow("Неизвестное")
    expect((await f.settings.read()).revision).toBe(saved.revision)
  } finally {await f.dispose()}
})

test("новая беседа выбирает Ollama до native запуска, дальнейшая смена подключения запрещена", async () => {
  const f = await fixture()
  let starts = 0
  let selected: string | undefined
  const sessions = createSessions({directory: () => join(f.project, "meta/chat"), resolve: () => f.subject,
    resolveExecution: value => f.settings.resolve(value),
    async connect(input) {
      starts += 1
      selected = input.execution.effective.connectionId
      return {sessionId: "native-ollama", capabilities: {}, configOptions: [],
        async setConfigOption() {return []}, async prompt() {return {stopReason: "end_turn"}}, async cancel() {}, async dispose() {}}
    },
  })
  try {
    await sessions.configureExecution("/", {scope: "session", selection: {connectionId: "gpu-ollama"}})
    expect(starts).toBe(0)
    expect((await sessions.read("/")).execution?.pinnedConnectionId).toBeUndefined()
    const prepared = await sessions.prepare("/")
    expect(prepared.execution?.pinnedConnectionId).toBe("gpu-ollama")
    expect((await sessions.read("/")).execution?.pinnedConnectionId).toBe("gpu-ollama")
    expect(selected).toBe("gpu-ollama")
    expect(starts).toBe(1)
    await expect(sessions.configureExecution("/", {scope: "session", selection: {connectionId: "primary-codex"}})).rejects.toThrow("несовместимое восстановление")
    const stored = await f.settings.read()
    await f.settings.update({...stored, connections: [connections[0]!, {id: "gpu-ollama", provider: "codex", label: "Переназначенное", enabled: true}]})
    await expect(sessions.prepare("/")).rejects.toThrow("Провайдер существующей native")
    expect(starts).toBe(1)
  } finally {await sessions.dispose(); await f.dispose()}
})


test("отсутствующее локальное подключение остаётся видимым для исправления, но не запускает исполнение", async () => {
  const f = await fixture()
  try {
    const saved = await f.settings.read()
    await f.settings.update({...saved, general: {connectionId: "gpu-ollama", model: "qwen"}})
    await unlink(join(f.project, ".local/execution-connections.json"))
    const snapshot = await f.settings.read()
    expect(snapshot.general.connectionId).toBe("gpu-ollama")
    expect(snapshot.connections.map(connection => connection.id)).toEqual(["codex"])
    await expect(f.settings.resolve({...f, selection: {}})).rejects.toThrow("Неизвестное")
    expect((await f.settings.resolve({...f, selection: {}, pinnedConnectionId: "codex"})).effective).toEqual({connectionId: "codex"})
    await f.settings.update({...snapshot, general: {connectionId: "codex"}})
    expect((await f.settings.read()).general.connectionId).toBe("codex")
  } finally {await f.dispose()}
})


test("сетевой endpoint не принимается из переносимого legacy документа", async () => {
  const f = await fixture()
  try {
    const snapshot = await f.settings.read()
    await writeFile(join(f.project, "meta/settings/execution.json"), JSON.stringify(snapshot))
    await expect(f.settings.read()).rejects.toThrow("только в локальном каталоге")
  } finally {await f.dispose()}
})


test("отказ переносимой записи не активирует pending endpoint и не меняет revision", async () => {
  const f = await fixture()
  const directory = join(f.project, "meta/settings")
  try {
    const current = await f.settings.read()
    await chmod(directory, 0o500)
    await expect(f.settings.update({...current, connections: [connections[0], {...connections[1], endpoint: {url: "http://new-host:11434"}}]})).rejects.toThrow()
    expect(await f.settings.read()).toEqual(current)
    await chmod(directory, 0o700)
    await f.settings.update({...current, connections: [connections[0], {...connections[1], endpoint: {url: "http://gpu_host:11434", ssh: {host: "gpu_alias", user: "model_user"}}}]})
    expect((await f.settings.read()).revision).toBe(current.revision + 1)
  } finally {await chmod(directory, 0o700); await f.dispose()}
})

test("смена endpoint одного провайдера сбрасывает каталог прежнего подключения", async () => {
  const f = await fixture()
  try {
    const current = await f.settings.read()
    await f.settings.update({...current,
      connections: [...connections, {...connections[1], id: "second-ollama", endpoint: {url: "http://another:11434"}}],
      general: {connectionId: "gpu-ollama", model: "only-on-first", thoughtLevel: "high"},
      types: {Project: {connectionId: "second-ollama"}},
    })
    expect((await f.settings.resolve({...f, selection: {}})).effective).toEqual({connectionId: "second-ollama"})
  } finally {await f.dispose()}
})
