import {expect, test} from "bun:test"
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSettings from "../index"

const peer = {peerId: "codespace:primary", executorId: "codex-primary"}
const local = {id: "local-codex", provider: "codex" as const, label: "Local", enabled: true}
const remote = {id: "stable-codex", provider: "codex" as const, label: "Remote", enabled: true, peer}
const connections = [remote,
  {id: "stable-ollama", provider: "ollama" as const, label: "Ollama", enabled: true,
    peer: {...peer, executorId: "ollama-local"}, endpoint: {url: "http://127.0.0.1:11434"}},
  {id: "stable-capsule", provider: "capsule" as const, label: "Capsule", enabled: true,
    peer: {...peer, executorId: "qwen-profile"}, endpoint: {url: "http://127.0.0.1:17777", profile: "qwen-ready", service: "qwen" as const}},
  {id: "stable-studio", provider: "chrome-studio" as const, label: "Studio", enabled: true,
    peer: {...peer, executorId: "chatgpt-profile"}, endpoint: {url: "http://127.0.0.1:17777", profile: "chatgpt-ready", service: "chatgpt" as const}},
]

/** Настройки сохраняются в отдельном временном Project, без сети или provider запуска. */
async function fixture() {
  const project = await mkdtemp(join(tmpdir(), "peer-settings-"))
  const settings = createSettings({project})
  const subject = {address: "/", label: "Project", cwd: project, type: "Project" as const}
  return {project, settings, subject, async dispose() {await rm(project, {recursive: true, force: true})}}
}

test("peer is independent of provider and keeps stable connection ID and pinned native selection", async () => {
  const f = await fixture()
  try {
    await f.settings.update({...await f.settings.read(), connections, general: {connectionId: remote.id, model: "selected", thoughtLevel: "high"}})
    const restored = createSettings({project: f.project})
    expect((await restored.read()).connections).toEqual(connections)
    const resolution = await restored.resolve({subject: f.subject, executorId: "worker-1", selection: {}, pinnedConnectionId: remote.id})
    expect(resolution.pinnedConnectionId).toBe(remote.id)
    expect(resolution.effective).toEqual({connectionId: remote.id, model: "selected", thoughtLevel: "high"})
    expect(resolution.connections[0]?.peer).toEqual(peer)
    const stored = JSON.parse(await readFile(join(f.project, ".local/execution-connections.json"), "utf8"))
    expect(stored.current.connections).toEqual(connections)
    expect(JSON.parse(await readFile(join(f.project, "meta/settings/execution.json"), "utf8")).connections).toBeUndefined()
    await expect(restored.resolve({subject: f.subject, executorId: "worker-1", selection: {connectionId: "stable-ollama"}, pinnedConnectionId: remote.id})).rejects.toThrow("несовместимое восстановление")
  } finally {await f.dispose()}
})

test("peer identity accepts only explicit IDs and rejects launch fields", async () => {
  const f = await fixture()
  try {
    const saved = await f.settings.read()
    for (const invalid of [
      {}, {peerId: "host"}, {executorId: "executor"}, {peerId: "", executorId: "executor"},
      {peerId: " host", executorId: "executor"}, {peerId: "host/other", executorId: "executor"},
      {peerId: "host", executorId: "../shell"}, {peerId: "host", executorId: "a".repeat(257)},
      {peerId: "host", executorId: "executor", command: "shell"}, {peerId: "host", executorId: "executor", token: "secret"},
    ]) {
      await expect(f.settings.update({...saved, connections: [{...remote, peer: invalid} as typeof remote]})).rejects.toThrow()
    }
    expect(await f.settings.read()).toEqual(saved)
  } finally {await f.dispose()}
})

test("peer and SSH are rejected as ambiguous for every provider", async () => {
  const f = await fixture()
  try {
    const saved = await f.settings.read()
    for (const connection of connections) {
      const ambiguous = connection.provider === "ollama"
        ? {...connection, endpoint: {...connection.endpoint, ssh: {host: "remote"}}}
        : {...connection, ssh: {host: "remote", providerRoot: "/provider", storageRoot: "/storage"}}
      await expect(f.settings.update({...saved, connections: [ambiguous]})).rejects.toThrow("Peer и SSH")
    }
  } finally {await f.dispose()}
})

test("implicit Codex selection prefers local process over a peer listed first", async () => {
  const f = await fixture()
  try {
    await f.settings.update({...await f.settings.read(), connections: [remote, local], general: {}})
    expect((await f.settings.resolve({subject: f.subject, executorId: "worker-1", selection: {}})).effective.connectionId).toBe(local.id)
  } finally {await f.dispose()}
})

test("portable document cannot provide peer addresses", async () => {
  const f = await fixture()
  try {
    const saved = await f.settings.update({...await f.settings.read()})
    await writeFile(join(f.project, "meta/settings/execution.json"), JSON.stringify({...saved, connections: [remote]}))
    await expect(f.settings.read()).rejects.toThrow("только в локальном каталоге")
  } finally {await f.dispose()}
})
