import {expect, test} from "bun:test"
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSettings from "../index"

const local = {id: "codex", provider: "codex" as const, label: "Codex", enabled: true}
const remote = {id: "codex-codespace", provider: "codex" as const, label: "Codex · Codespace", enabled: true,
  ssh: {host: "codespace-host", user: "codespace", port: 2222, providerRoot: "/workspaces/provider", storageRoot: "/workspaces/state"}}

async function fixture() {
  const project = await mkdtemp(join(tmpdir(), "codex-ssh-settings-"))
  const settings = createSettings({project})
  const subject = {address: "/", label: "Project", cwd: project, type: "Project" as const}
  return {project, settings, subject, dispose: () => rm(project, {recursive: true, force: true})}
}

test("отдельный Codex через SSH сохраняет подключение, модель и мышление после повторного чтения", async () => {
  const f = await fixture()
  try {
    expect((await f.settings.read()).connections).toEqual([local])
    await f.settings.update({...await f.settings.read(), connections: [local, remote],
      general: {connectionId: remote.id, model: "remote-model", thoughtLevel: "high"}})
    const restored = createSettings({project: f.project})
    expect((await restored.read()).connections).toEqual([local, remote])
    const execution = await restored.resolve({subject: f.subject, executorId: "developer:project", selection: {}, pinnedConnectionId: remote.id})
    expect(execution.effective).toEqual({connectionId: remote.id, model: "remote-model", thoughtLevel: "high"})
    expect(execution.pinnedConnectionId).toBe(remote.id)
    expect(execution.connections.find(connection => connection.id === remote.id)).toEqual(remote)
    expect(JSON.parse(await readFile(join(f.project, ".local/execution-connections.json"), "utf8")).current.connections).toEqual([local, remote])
    expect(JSON.parse(await readFile(join(f.project, "meta/settings/execution.json"), "utf8")).connections).toBeUndefined()
  } finally {await f.dispose()}
})

test("неявный выбор предпочитает локальный Codex, даже когда удалённый записан первым", async () => {
  const f = await fixture()
  try {
    await f.settings.update({...await f.settings.read(), connections: [remote, local], general: {}})
    expect((await f.settings.resolve({subject: f.subject, executorId: "developer:project", selection: {}})).effective).toEqual({connectionId: local.id})
    expect((await f.settings.resolve({subject: f.subject, executorId: "developer:project", selection: {connectionId: remote.id}})).effective).toEqual({connectionId: remote.id})
  } finally {await f.dispose()}
})

test("Codex SSH принимает только адрес и нормализованные пути, без команд и browser-полей", async () => {
  const f = await fixture()
  try {
    const saved = await f.settings.update({...await f.settings.read()})
    const invalid = [
      {...remote, endpoint: {url: "http://localhost:17777"}},
      {...remote, remoteCwd: "/workspaces/project"},
      {...remote, ssh: {...remote.ssh, host: "-oProxyCommand=sh"}},
      {...remote, ssh: {...remote.ssh, host: "host;sh"}},
      {...remote, ssh: {...remote.ssh, user: "user;sh"}},
      {...remote, ssh: {...remote.ssh, port: 0}},
      {...remote, ssh: {...remote.ssh, port: 65536}},
      {...remote, ssh: {...remote.ssh, providerRoot: "relative"}},
      {...remote, ssh: {...remote.ssh, storageRoot: "/workspaces/../state"}},
      {...remote, ssh: {...remote.ssh, storageRoot: "/state\nother"}},
      {...remote, ssh: {...remote.ssh, providerRoot: undefined}},
      {...remote, ssh: {...remote.ssh, storageRoot: undefined}},
      {...remote, ssh: {...remote.ssh, command: "shell"}},
      {...remote, ssh: {...remote.ssh, password: "secret"}},
      {...remote, ssh: {...remote.ssh, dockerContext: "browser"}},
    ]
    for (const connection of invalid) await expect(f.settings.update({...saved, connections: [connection] as typeof saved.connections})).rejects.toThrow()
    expect(await f.settings.read()).toEqual(saved)
    await writeFile(join(f.project, "meta/settings/execution.json"), JSON.stringify({...saved, connections: [remote]}))
    await expect(f.settings.read()).rejects.toThrow("только в локальном каталоге")
  } finally {await f.dispose()}
})
