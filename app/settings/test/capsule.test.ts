import {expect, test} from "bun:test"
import {mkdtemp, readFile, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSettings from "../index"
import createSessions, {type StorybookChatSession} from "@zavx0z/storybook-chat-session"

const capsule = {id: "capsule-work", provider: "capsule" as const, label: "Рабочий профиль", enabled: true,
  endpoint: {url: "http://127.0.0.1:17777", profile: "work", service: "qwen" as const}}

async function fixture() {
  const project = await mkdtemp(join(tmpdir(), "capsule-settings-"))
  const settings = createSettings({project})
  const subject = {address: "/", label: "Project", cwd: project, type: "Project" as const}
  await settings.update({...await settings.read(), connections: [capsule], general: {connectionId: capsule.id}})
  return {project, settings, subject, dispose: () => rm(project, {recursive: true, force: true})}
}

test("профиль Capsule сохраняется локально и восстанавливается после restart", async () => {
  const f = await fixture()
  try {
    expect((await createSettings({project: f.project}).read()).connections).toEqual([capsule])
    expect(JSON.parse(await readFile(join(f.project, ".local/execution-connections.json"), "utf8")).current.connections).toEqual([capsule])
    const portable = JSON.parse(await readFile(join(f.project, "meta/settings/execution.json"), "utf8"))
    expect(portable.connections).toBeUndefined()
    expect(portable.general).toEqual({connectionId: capsule.id})
    for (const url of ["http://localhost:17777", "http://127.0.0.1:17777/", "http://[::1]:17777"]) {
      const current = await f.settings.read()
      await f.settings.update({...current, connections: [{...capsule, endpoint: {...capsule.endpoint, url, service: "deepseek"}}]})
    }
    expect((await f.settings.read()).connections[0]).toEqual({...capsule, endpoint: {...capsule.endpoint, url: "http://[::1]:17777", service: "deepseek"}})
  } finally {await f.dispose()}
})

test("Capsule требует локальный Studio, явный профиль и поддерживаемый сервис", async () => {
  const f = await fixture()
  try {
    const saved = await f.settings.read()
    for (const endpoint of [
      {...capsule.endpoint, url: "http://remote:17777"},
      {...capsule.endpoint, url: "http://127.0.0.1:17777/api"},
      {...capsule.endpoint, url: "http://user:secret@localhost:17777"},
      {...capsule.endpoint, url: "file:///tmp/capsule"},
      {...capsule.endpoint, url: "http://localhost:17777?token=x"},
      {...capsule.endpoint, url: "http://localhost:17777#profile"},
      {...capsule.endpoint, url: " http://localhost:17777"},
      {...capsule.endpoint, profile: ""},
      {...capsule.endpoint, profile: " work "},
      {...capsule.endpoint, profile: "x".repeat(201)},
      {...capsule.endpoint, profile: "../work"},
      {...capsule.endpoint, profile: "work profile"},
      {...capsule.endpoint, profile: undefined},
      {...capsule.endpoint, service: "other"},
      {...capsule.endpoint, service: undefined},
      {...capsule.endpoint, cdpUrl: "http://localhost:9222"},
      {...capsule.endpoint, ssh: {host: "gpu"}},
    ]) {
      await expect(f.settings.update({...saved, connections: [{...capsule, endpoint}] as typeof saved.connections})).rejects.toThrow()
    }
    expect(await f.settings.read()).toEqual(saved)
  } finally {await f.dispose()}
})

test("native сессия Capsule сохраняет провайдера и закреплённое подключение при восстановлении", async () => {
  const f = await fixture()
  const resumed: (string | undefined)[] = []
  const sessionInput: StorybookChatSession.Input = {
    directory: () => join(f.project, "meta/chat"), resolve: () => f.subject,
    resolveExecution: value => f.settings.resolve(value),
    async connect(input) {
      resumed.push(input.previousSessionId)
      expect(input.execution.connections.find(connection => connection.id === input.execution.effective.connectionId)).toEqual(capsule)
      return {sessionId: "native-capsule", capabilities: {}, configOptions: [],
        async setConfigOption() {return []}, async prompt() {return {stopReason: "end_turn"}}, async cancel() {}, async dispose() {}}
    },
  }
  const first = createSessions(sessionInput)
  let restored: ReturnType<typeof createSessions> | undefined
  try {
    expect((await first.prepare("/")).execution?.pinnedConnectionId).toBe(capsule.id)
    await first.dispose()
    restored = createSessions(sessionInput)
    expect((await restored.prepare("/")).execution?.pinnedConnectionId).toBe(capsule.id)
    expect(resumed).toEqual([undefined, "native-capsule"])
    const current = await f.settings.read()
    await f.settings.update({...current, connections: [{id: capsule.id, provider: "codex", label: "Переназначенное", enabled: true}]})
    await expect(restored.prepare("/")).rejects.toThrow("Провайдер существующей native")
    expect(resumed).toHaveLength(2)
  } finally {await restored?.dispose(); await first.dispose(); await f.dispose()}
})
