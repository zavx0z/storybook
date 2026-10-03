import {expect, test} from "bun:test"
import {Client, InMemoryTransport} from "@modelcontextprotocol/client"
import createApp from "@storybook/app"
import State from "@app-server/state"
import {existsSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import {createAppMcpServer} from "../src/mcp"
import {createLazyStartupFixture} from "./fixtures/lazy-startup"

test.each(["early", "late"] as const)("SDK ensure: ready %s, стадии до ответа и повторное использование daemon", async readyOrder => {
  const fixture = createLazyStartupFixture()
  const previousRoot = Bun.env.STORYBOOK_STATE_ROOT
  const previousFixture = Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE
  Bun.env.STORYBOOK_STATE_ROOT = fixture.stateRoot
  Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE = "isolated"
  const context = () => ({signal: AbortSignal.timeout(10_000)})
  const app = createApp({
    toolRoot: fixture.toolRoot,
    daemonEntryPath: join(import.meta.dir, "fixtures/progress-daemon.ts"),
    legacyStatePaths: [],
  })
  const server = createAppMcpServer({controller: app, recordRequest: async () => {}})
  const client = new Client({name: "startup-progress-test", version: "1"})
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  try {
    let completed = false
    const progress: {progress: number, message?: string | undefined}[] = []
    const first = await client.callTool({name: "storybook_ensure", arguments: {schemaVersion: 1}}, {
      onprogress(value) {
        expect(completed).toBeFalse()
        progress.push(value)
        if (progress.length === 1) writeFileSync(join(fixture.stateRoot, "continue-startup"), readyOrder)
      },
    }).then(value => { completed = true; return value })
    expect(first.isError).not.toBeTrue()
    expect(progress.map(value => value.progress)).toEqual([1, 2])
    expect(progress.map(value => JSON.parse(value.message!).phase)).toEqual(["catalog", "ready"])
    if (readyOrder === "late") {
      writeFileSync(join(fixture.stateRoot, "emit-ready"), "ready")
      const deadline = Date.now() + 5_000
      while (!existsSync(join(fixture.stateRoot, "ready-emitted"))) {
        if (Date.now() >= deadline) throw new Error("Fixture did not emit late ready")
        await Bun.sleep(10)
      }
    }
    const record = State.readExternalStorybookServerRecord(State.externalStorybookServerStatePath())
    const reused = await client.callTool({name: "storybook_ensure", arguments: {schemaVersion: 1}}, {
      onprogress: value => { progress.push(value) },
    })
    expect((reused.structuredContent as Record<string, unknown>).instanceId)
      .toBe((first.structuredContent as Record<string, unknown>).instanceId)
    expect(State.readExternalStorybookServerRecord(State.externalStorybookServerStatePath()).pid).toBe(record.pid)
    expect(progress).toHaveLength(2)
  } finally {
    await client.close()
    await server.close()
    try { await app.stop({schemaVersion: 1, confirm: true}, context()) } finally {
      if (previousRoot === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
      else Bun.env.STORYBOOK_STATE_ROOT = previousRoot
      if (previousFixture === undefined) delete Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE
      else Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE = previousFixture
      fixture.dispose()
    }
  }
}, 15_000)

test.each(["finish", "abort", "abort-ready"] as const)("ensure %s: отправка последней стадии и очистка отменённого запуска", async mode => {
  const fixture = createLazyStartupFixture()
  const previousRoot = Bun.env.STORYBOOK_STATE_ROOT
  const previousFixture = Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE
  Bun.env.STORYBOOK_STATE_ROOT = fixture.stateRoot
  Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE = "isolated"
  const cancellation = new AbortController()
  let child: Bun.Subprocess<"ignore", "ignore", "pipe"> | undefined
  let release = () => {}
  const delivery = new Promise<void>(resolve => { release = resolve })
  let reached = () => {}
  const observed = new Promise<void>(resolve => { reached = resolve })
  const app = createApp({
    toolRoot: fixture.toolRoot,
    daemonEntryPath: join(import.meta.dir, "fixtures/progress-daemon.ts"),
    legacyStatePaths: [],
    spawnDaemon(input) {
      child = Bun.spawn([process.execPath, input.entryPath], {
        cwd: input.toolRoot,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
        env: {
          ...Bun.env,
          STORYBOOK_START_LEASE_PATH: input.startLease.path,
          STORYBOOK_START_LEASE_TOKEN: input.startLease.token,
        },
      })
      return child
    },
  })
  try {
    let completed = false
    const startup = app.ensure({schemaVersion: 1}, {
      signal: cancellation.signal,
      onProgress: async progress => {
        if (mode === "abort") {
          reached()
          await delivery
        } else if (progress.phase === "catalog") {
          writeFileSync(join(fixture.stateRoot, "continue-startup"), "ready")
        } else {
          reached()
          await delivery
        }
      },
    }).then(value => { completed = true; return value })
    // Сразу присоединяем обработчик: отмена не создаёт unhandled rejection.
    const result = startup.then(value => ({value}), error => ({error}))
    await observed
    if (mode === "abort") {
      cancellation.abort(new DOMException("cancel startup", "AbortError"))
      expect(await result).toHaveProperty("error")
      expect(State.processExists(child!.pid)).toBeFalse()
    } else {
      const deadline = Date.now() + 5_000
      while ((await State.inspectExternalStorybookServer()).state !== "running") {
        if (Date.now() >= deadline) throw new Error("Fixture did not publish ready state")
        await Bun.sleep(10)
      }
      expect(completed, "Готовность daemon ещё не завершает ensure, пока отправка progress ожидает").toBeFalse()
      if (mode === "abort-ready") {
        cancellation.abort(new DOMException("cancel progress delivery", "AbortError"))
        expect(await result).toHaveProperty("error")
        expect(State.processExists(child!.pid), "Подтверждённый running daemon сохраняется после отмены запроса").toBeTrue()
      } else {
        release()
        expect(await result).toMatchObject({value: {status: "success", server: "running"}})
      }
    }
  } finally {
    release()
    cancellation.abort()
    try {
      if ((await State.inspectExternalStorybookServer()).state === "running") {
        await app.stop({schemaVersion: 1, confirm: true}, {signal: AbortSignal.timeout(5_000)})
      }
    } finally {
      if (previousRoot === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
      else Bun.env.STORYBOOK_STATE_ROOT = previousRoot
      if (previousFixture === undefined) delete Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE
      else Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE = previousFixture
      fixture.dispose()
    }
  }
}, 10_000)
