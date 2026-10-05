import createApp from "@zavx0z/storybook-app"
import ServerState from "@zavx0z/storybook-app-server-state"
import {expect, test} from "bun:test"
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import {createLazyStartupFixture} from "./fixtures/lazy-startup"

test("cold ensure запускает один detached daemon, который переживает exit fresh public App callers", async () => {
  const fixture = createLazyStartupFixture()
  const previousRoot = Bun.env.STORYBOOK_STATE_ROOT
  const previousFixture = Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE
  Bun.env.STORYBOOK_STATE_ROOT = fixture.stateRoot
  Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE = "isolated"
  const statePath = join(fixture.stateRoot, "server.json")
  try {
    const before = await fixture.request("status")
    expect(before, "status читает отсутствие daemon без запуска").toMatchObject({status: "success", server: "stopped"})
    expect(existsSync(statePath)).toBeFalse()
    expect(existsSync(join(fixture.stateRoot, "daemon-starts.jsonl"))).toBeFalse()

    const first = await fixture.request("ensure")
    expect(first).toMatchObject({status: "success", server: "running"})
    const record = ServerState.readExternalStorybookServerRecord(statePath)
    expect(record.toolRoot).toBe(fixture.toolRoot)
    expect(existsSync(`${statePath}.start.lock`), "Успешный ensure завершил cleanup startup lease до возврата").toBeFalse()
    const firstEnsure = fixture.trace().find(entry => entry.operation === "ensure" && entry.status === "success")!
    expect(firstEnsure).toBeDefined()
    expect(existsSync(join(fixture.eventsRoot, `${firstEnsure.pid}.exited`)), "Работа ensure завершена вместе с caller process").toBeTrue()
    expect(ServerState.processExists(firstEnsure.pid)).toBeFalse()
    expect(ServerState.processExists(record.pid), "Detached daemon остаётся живым после выхода caller").toBeTrue()

    const observed = await fixture.request("status")
    expect(observed).toMatchObject({status: "success", server: "running", instanceId: record.instanceId})
    const second = await fixture.request("ensure")
    expect(second).toMatchObject({status: "success", server: "running", instanceId: record.instanceId})
    expect(ServerState.readExternalStorybookServerRecord(statePath).pid).toBe(record.pid)
    const starts = readFileSync(join(fixture.stateRoot, "daemon-starts.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line))
    expect(starts, "Повторный ensure другого caller переиспользует тот же daemon и canonical lease")
      .toEqual([{pid: record.pid, instanceId: record.instanceId}])
    const ensures = fixture.trace().filter(entry => entry.operation === "ensure" && entry.status === "success")
    expect(ensures).toHaveLength(2)
    expect(new Set(ensures.map(entry => entry.pid)).size, "Управляющие вызовы прошли через два свежих процесса").toBe(2)
    expect(ensures.every(entry => existsSync(join(fixture.eventsRoot, `${entry.pid}.exited`)) && !ServerState.processExists(entry.pid))).toBeTrue()

    const endpoint = new URL("/api/environment", record.origin)
    const headers = {authorization: `Bearer ${record.controlToken}`}
    const bootstrapResponse = await fetch(endpoint, {headers})
    expect(bootstrapResponse.status).toBe(200)
    const bootstrap = await bootstrapResponse.json() as {result: {tools: {name: string}[]}}
    expect(bootstrap.result.tools.some(tool => tool.name === "storybook_status")).toBeTrue()
    expect(bootstrap.result.tools.some(tool => tool.name === "storybook_ensure" || tool.name === "storybook_stop"),
      "Работающий REST вход не получает управление собственным запуском").toBeFalse()
    const restResponse = await fetch(endpoint, {method: "POST", headers: {...headers, "content-type": "application/json"},
      body: JSON.stringify({name: "storybook_status", arguments: {schemaVersion: 1}})})
    expect(restResponse.status).toBe(200)
    expect((await restResponse.json() as {result: unknown}).result).toMatchObject({status: "success", server: "running", instanceId: record.instanceId})

    const uiPackage = join(fixture.toolRoot, "app/web/ui")
    mkdirSync(uiPackage, {recursive: true})
    writeFileSync(join(uiPackage, "package.json"), JSON.stringify({name: "@fixture/lazy-ui", exports: {".": "./index.ts"}}))
    writeFileSync(join(uiPackage, "index.ts"), "export const view = 'browser only'\n")
    writeFileSync(join(fixture.toolRoot, "bun.lock"), JSON.stringify({
      workspaces: {"app/web/ui": {name: "@fixture/lazy-ui"}},
      packages: {"@fixture/lazy-ui": ["@fixture/lazy-ui@workspace:app/web/ui"]},
    }))
    expect(await fixture.request("status")).toMatchObject({status: "success", server: "running", instanceId: record.instanceId})
    expect(await fixture.request("ensure")).toMatchObject({status: "success", server: "running", instanceId: record.instanceId})
    expect(ServerState.readExternalStorybookServerRecord(statePath).pid).toBe(record.pid)

    writeFileSync(join(fixture.toolRoot, "server.ts"), "export const resident = 'second'\n")
    expect(await fixture.request("status")).toMatchObject({status: "success", server: "running", instanceId: record.instanceId})
    expect(await fixture.request("ensure")).toMatchObject({status: "success", server: "running", instanceId: record.instanceId})
    const reused = ServerState.readExternalStorybookServerRecord(statePath)
    expect(reused.pid).toBe(record.pid)
    expect(reused.instanceId).toBe(record.instanceId)
    expect(readFileSync(join(fixture.stateRoot, "daemon-starts.jsonl"), "utf8").trim().split("\n")).toHaveLength(1)
  } finally {
    try {
      if (existsSync(statePath) && ServerState.readExternalStorybookServerRecord(statePath).toolRoot === fixture.toolRoot) {
        const app = createApp({toolRoot: fixture.toolRoot, daemonEntryPath: fixture.daemonEntryPath, legacyStatePaths: []})
        try { await app.stop({schemaVersion: 1, confirm: true}, {signal: AbortSignal.timeout(5_000)}) }
        catch {
          const owned = ServerState.readExternalStorybookServerRecord(statePath)
          if (owned.toolRoot === fixture.toolRoot && ServerState.processExists(owned.pid)) process.kill(owned.pid, "SIGTERM")
        }
      }
    } finally {
      if (previousRoot === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
      else Bun.env.STORYBOOK_STATE_ROOT = previousRoot
      if (previousFixture === undefined) delete Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE
      else Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE = previousFixture
      fixture.dispose()
    }
  }
}, 30_000)
