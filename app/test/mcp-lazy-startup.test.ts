import createLazyMcpServer from "@zavx0z/storybook-tech-mcp-lazy"
import createApp from "@zavx0z/storybook-app"
import ServerState from "@zavx0z/storybook-app-server-state"
import {Client, InMemoryTransport} from "@modelcontextprotocol/client"
import {expect, test} from "bun:test"
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import {createLazyStartupFixture} from "./fixtures/lazy-startup"

test("cold ensure запускает один detached daemon, который переживает exit fresh MCP request workers", async () => {
  const fixture = createLazyStartupFixture()
  const previousRoot = Bun.env.STORYBOOK_STATE_ROOT
  const previousFixture = Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE
  Bun.env.STORYBOOK_STATE_ROOT = fixture.stateRoot
  Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE = "isolated"
  const server = createLazyMcpServer(fixture.options)
  const client = new Client({name: "cold-lazy-native-client", version: "1"}, {
    versionNegotiation: {mode: "auto", probe: {timeoutMs: 1000}},
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const statePath = join(fixture.stateRoot, "server.json")
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    const before = await client.callTool({name: "storybook_status", arguments: {schemaVersion: 1}})
    expect(before.isError).not.toBeTrue()
    expect(before.structuredContent, "status читает отсутствие daemon без запуска")
      .toMatchObject({status: "success", server: "stopped"})
    expect(existsSync(statePath)).toBeFalse()
    expect(existsSync(join(fixture.stateRoot, "daemon-starts.jsonl"))).toBeFalse()

    const first = await client.callTool({name: "storybook_ensure", arguments: {schemaVersion: 1}})
    expect(first.isError, `Cold ensure должен завершиться успешно: ${JSON.stringify(first.content)}`).not.toBeTrue()
    expect(first.structuredContent).toMatchObject({status: "success", server: "running"})
    const record = ServerState.readExternalStorybookServerRecord(statePath)
    expect(record.toolRoot).toBe(fixture.toolRoot)
    expect(existsSync(`${statePath}.start.lock`), "Успешный ensure завершил cleanup startup lease до возврата")
      .toBeFalse()
    const firstEnsure = fixture.trace().find(entry => entry.tool === "storybook_ensure" && entry.status === "success")!
    expect(firstEnsure).toBeDefined()
    expect(existsSync(join(fixture.eventsRoot, `${firstEnsure.pid}.exited`)), "Работа ensure завершена вместе с request worker")
      .toBeTrue()
    expect(ServerState.processExists(firstEnsure.pid)).toBeFalse()
    expect(ServerState.processExists(record.pid), "Detached daemon остаётся живым после выхода request worker")
      .toBeTrue()

    const observed = await client.callTool({name: "storybook_status", arguments: {schemaVersion: 1}})
    expect(observed.isError).not.toBeTrue()
    expect(observed.structuredContent).toMatchObject({status: "success", server: "running", instanceId: record.instanceId})
    const second = await client.callTool({name: "storybook_ensure", arguments: {schemaVersion: 1}})
    expect(second.isError).not.toBeTrue()
    expect(second.structuredContent).toMatchObject({status: "success", server: "running", instanceId: record.instanceId})
    expect(ServerState.readExternalStorybookServerRecord(statePath).pid).toBe(record.pid)
    const starts = readFileSync(join(fixture.stateRoot, "daemon-starts.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line))
    expect(starts, "Повторный ensure другого worker переиспользует тот же daemon и canonical lease")
      .toEqual([{pid: record.pid, instanceId: record.instanceId}])
    const ensures = fixture.trace().filter(entry => entry.tool === "storybook_ensure" && entry.status === "success")
    expect(ensures).toHaveLength(2)
    expect(new Set(ensures.map(entry => entry.pid)).size, "Управляющие вызовы прошли через два свежих процесса")
      .toBe(2)

    const uiPackage = join(fixture.toolRoot, "app/web/ui")
    mkdirSync(uiPackage, {recursive: true})
    writeFileSync(join(uiPackage, "package.json"), JSON.stringify({name: "@fixture/lazy-ui", exports: {".": "./index.ts"}}))
    writeFileSync(join(uiPackage, "index.ts"), "export const view = 'browser only'\n")
    const lockPath = join(fixture.toolRoot, "bun.lock")
    const lock = {
      workspaces: {"app/web/ui": {name: "@fixture/lazy-ui"}},
      packages: {"@fixture/lazy-ui": ["@fixture/lazy-ui@workspace:app/web/ui"]},
    }
    writeFileSync(lockPath, JSON.stringify(lock))
    const uiStatus = await client.callTool({name: "storybook_status", arguments: {schemaVersion: 1}})
    expect(uiStatus.structuredContent).toMatchObject({status: "success", server: "running", instanceId: record.instanceId})
    const uiEnsure = await client.callTool({name: "storybook_ensure", arguments: {schemaVersion: 1}})
    expect(uiEnsure.structuredContent).toMatchObject({status: "success", server: "running", instanceId: record.instanceId})
    expect(ServerState.readExternalStorybookServerRecord(statePath).pid).toBe(record.pid)

    writeFileSync(join(fixture.toolRoot, "server.ts"), "export const resident = 'second'\n")
    const changedStatus = await client.callTool({name: "storybook_status", arguments: {schemaVersion: 1}})
    expect(changedStatus.structuredContent).toMatchObject({status: "success", server: "running", instanceId: record.instanceId})
    const changedEnsure = await client.callTool({name: "storybook_ensure", arguments: {schemaVersion: 1}})
    expect(changedEnsure.structuredContent).toMatchObject({status: "success", server: "running"})
    const replacement = ServerState.readExternalStorybookServerRecord(statePath)
    expect(replacement.instanceId).toBe(record.instanceId)
    expect(replacement.pid).toBe(record.pid)
    expect(readFileSync(join(fixture.stateRoot, "daemon-starts.jsonl"), "utf8").trim().split("\n")).toHaveLength(1)
    expect(server.isConnected()).toBeTrue()
  } finally {
    try {
      if (existsSync(statePath) && ServerState.readExternalStorybookServerRecord(statePath).toolRoot === fixture.toolRoot) {
        const cleanup = createApp({toolRoot: fixture.toolRoot, daemonEntryPath: fixture.daemonEntryPath, legacyStatePaths: []})
        try {
          await cleanup.stop({schemaVersion: 1, confirm: true}, {signal: AbortSignal.timeout(5000)})
        } catch {
          const owned = ServerState.readExternalStorybookServerRecord(statePath)
          if (owned.toolRoot === fixture.toolRoot && ServerState.processExists(owned.pid)) {
            process.kill(owned.pid, "SIGTERM")
          }
        }
      }
    } finally {
      try {
        await client.close()
      } finally {
        try {
          await server.close()
        } finally {
          if (previousRoot === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
          else Bun.env.STORYBOOK_STATE_ROOT = previousRoot
          if (previousFixture === undefined) delete Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE
          else Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE = previousFixture
          fixture.dispose()
        }
      }
    }
  }
}, 30_000)
