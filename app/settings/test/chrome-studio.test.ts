import {expect, test} from "bun:test"
import {mkdtemp, readFile, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSettings from "@zavx0z/storybook-app-settings"

test("Chrome Studio connection persists separately and rejects Docker and direct CDP settings", async () => {
  const project = await mkdtemp(join(tmpdir(), "studio-settings-"))
  const settings = createSettings({project})
  const connection = {id: "deepseek-studio", provider: "chrome-studio" as const, label: "DeepSeek", enabled: true,
    endpoint: {url: "http://127.0.0.1:17778", profile: "chosen", service: "deepseek" as const},
    ssh: {host: "second-mac", providerRoot: "/repos/provider", storageRoot: "/data/provider"}}
  try {
    await settings.update({...await settings.read(), connections: [connection], general: {connectionId: connection.id}})
    expect((await createSettings({project}).read()).connections).toEqual([connection])
    expect(JSON.parse(await readFile(join(project, "meta/settings/execution.json"), "utf8")).connections).toBeUndefined()
    const current = await settings.read()
    const invalidDocker = {...connection, ssh: {...connection.ssh, dockerContext: "wrong"}}
    const invalidCdp = {...connection, endpoint: {...connection.endpoint, cdpUrl: "ws://localhost:9222"}}
    await expect(settings.update({...current, connections: [invalidDocker]})).rejects.toThrow()
    await expect(settings.update({...current, connections: [invalidCdp]})).rejects.toThrow()

  } finally {await rm(project, {recursive: true, force: true})}
})

test.each(["capsule", "chrome-studio"] as const)("%s сохраняет ChatGPT и передаёт сервис в разрешённое подключение", async provider => {
  const project = await mkdtemp(join(tmpdir(), "chatgpt-settings-"))
  const settings = createSettings({project})
  const connection = {id: `chatgpt-${provider}`, provider, label: "ChatGPT", enabled: true,
    endpoint: {url: provider === "capsule" ? "http://127.0.0.1:17777" : "http://127.0.0.1:17778", profile: "chatgpt", service: "chatgpt" as const}}
  try {
    await settings.update({...await settings.read(), connections: [connection], general: {connectionId: connection.id}})
    const restored = createSettings({project})
    expect((await restored.read()).connections).toEqual([connection])
    const execution = await restored.resolve({subject: {address: "/", label: "Project", cwd: project, type: "Project"}, executorId: "developer:project", selection: {}})
    expect(execution.effective.connectionId).toBe(connection.id)
    expect(execution.connections.find(item => item.id === execution.effective.connectionId)).toEqual(connection)
    expect(JSON.parse(await readFile(join(project, ".local/execution-connections.json"), "utf8")).current.connections).toEqual([connection])
    expect(JSON.parse(await readFile(join(project, "meta/settings/execution.json"), "utf8")).connections).toBeUndefined()
  } finally {await rm(project, {recursive: true, force: true})}
})
