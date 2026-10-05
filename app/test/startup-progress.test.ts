import {expect, test} from "bun:test"
import createApp from "@zavx0z/storybook-app"
import State from "@zavx0z/storybook-app-server-state"
import {existsSync, statSync, writeFileSync} from "node:fs"
import {join} from "node:path"
import {createLazyStartupFixture} from "./fixtures/lazy-startup"

test("public App ensure parent завершается естественно после ready, detached daemon остаётся жив", async () => {
  const fixture = createLazyStartupFixture()
  const previousRoot = Bun.env.STORYBOOK_STATE_ROOT
  const previousFixture = Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE
  Bun.env.STORYBOOK_STATE_ROOT = fixture.stateRoot
  Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE = "isolated"
  const parentPath = join(fixture.root, "ensure-parent.ts")
  const daemonPath = join(fixture.root, "lifecycle-daemon.ts")
  writeFileSync(daemonPath, `
import {existsSync, writeFileSync} from "node:fs"
import {join} from "node:path"
await import(${JSON.stringify(fixture.daemonEntryPath)})
while (!existsSync(join(Bun.env.STORYBOOK_STATE_ROOT!, "parent-finished"))) await Bun.sleep(5)
await Bun.stderr.write("late daemon diagnostic\\n")
writeFileSync(join(Bun.env.STORYBOOK_STATE_ROOT!, "late-stderr-written"), "written")
`)
  writeFileSync(parentPath, `
import createApp from "@zavx0z/storybook-app"
const app = createApp({toolRoot: ${JSON.stringify(fixture.toolRoot)}, daemonEntryPath: ${JSON.stringify(daemonPath)}, legacyStatePaths: []})
const result = await app.ensure({schemaVersion: 1}, {signal: new AbortController().signal})
console.log(JSON.stringify(result))
`)
  const app = createApp({toolRoot: fixture.toolRoot, daemonEntryPath: daemonPath, legacyStatePaths: []})
  const parent = Bun.spawn([process.execPath, parentPath], {
    cwd: fixture.toolRoot,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5_000,
    // Только fixture: no-orphans намеренно убивает daemon при выходе parent, противореча проверяемому lifecycle.
    env: {...Bun.env, BUN_FEATURE_FLAG_NO_ORPHANS: "0", STORYBOOK_STATE_ROOT: fixture.stateRoot, STORYBOOK_LAZY_STARTUP_FIXTURE: "isolated"},
  })
  const stdout = new Response(parent.stdout).text()
  const stderr = new Response(parent.stderr).text()
  try {
    const exitCode = await parent.exited
    expect(exitCode, "Caller заканчивает работу без process.exit и без ожидания завершения daemon").toBe(0)
    expect(parent.signalCode).toBeNull()
    expect(JSON.parse((await stdout).trim())).toMatchObject({status: "success", server: "running"})
    expect(await stderr).toBe("")
    const record = State.readExternalStorybookServerRecord(State.externalStorybookServerStatePath())
    expect(State.processExists(record.pid)).toBeTrue()
    const logPath = `${State.externalStorybookServerStatePath()}.stderr.log`
    expect(statSync(logPath).mode & 0o777).toBe(0o600)
    writeFileSync(join(fixture.stateRoot, "parent-finished"), "finished")
    const deadline = Date.now() + 1_000
    while (!existsSync(join(fixture.stateRoot, "late-stderr-written")) && State.processExists(record.pid) && Date.now() < deadline) await Bun.sleep(10)
    expect(existsSync(join(fixture.stateRoot, "late-stderr-written")), "Поздняя запись stderr после естественного выхода parent не завершает daemon").toBeTrue()
    expect(State.processExists(record.pid)).toBeTrue()
    expect(await Bun.file(logPath).text()).toContain("late daemon diagnostic")
    expect(await app.status({schemaVersion: 1}, {signal: new AbortController().signal}))
      .toMatchObject({server: "running", instanceId: record.instanceId})
    expect(State.readExternalStorybookServerRecord(State.externalStorybookServerStatePath()).pid).toBe(record.pid)
    expect((await fetch(new URL("/api/health", record.origin))).status).toBe(200)
  } finally {
    if (parent.exitCode === null) {
      parent.kill()
      await parent.exited
    }
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

test("private stderr file сохраняет bounded хвост startup ошибки и освобождает неготовый child", async () => {
  const fixture = createLazyStartupFixture()
  const previousRoot = Bun.env.STORYBOOK_STATE_ROOT
  const previousMarker = Bun.env.STORYBOOK_STDERR_FLOOD_DAEMON_MARKER
  Bun.env.STORYBOOK_STATE_ROOT = fixture.stateRoot
  const marker = join(fixture.stateRoot, "failed-daemon.pid")
  Bun.env.STORYBOOK_STDERR_FLOOD_DAEMON_MARKER = marker
  const app = createApp({toolRoot: fixture.toolRoot,
    daemonEntryPath: join(import.meta.dir, "fixtures/stderr-flood-daemon.ts"), legacyStatePaths: []})
  try {
    await expect(app.ensure({schemaVersion: 1}, {signal: AbortSignal.timeout(5_000)})).rejects.toThrow("Storybook startup: catalog")
    expect(State.processExists(Number(await Bun.file(marker).text()))).toBeFalse()
    expect(existsSync(`${State.externalStorybookServerStatePath()}.start.lock`)).toBeFalse()
    expect(existsSync(State.externalStorybookServerStatePath())).toBeFalse()
  } finally {
    if (previousRoot === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
    else Bun.env.STORYBOOK_STATE_ROOT = previousRoot
    if (previousMarker === undefined) delete Bun.env.STORYBOOK_STDERR_FLOOD_DAEMON_MARKER
    else Bun.env.STORYBOOK_STDERR_FLOOD_DAEMON_MARKER = previousMarker
    fixture.dispose()
  }
}, 10_000)

test.each(["early", "late"] as const)("public App ensure: ready %s, стадии до ответа и повторное использование daemon", async readyOrder => {
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
  try {
    let completed = false
    const progress: {phase: string, at: number}[] = []
    const recordProgress = (value: Readonly<Record<string, unknown>>) => {
      if (typeof value.phase !== "string" || typeof value.at !== "number" || !Number.isFinite(value.at)) {
        throw new TypeError("Startup progress должен содержать phase и конечный timestamp at")
      }
      progress.push({phase: value.phase, at: value.at})
    }
    const first = await app.ensure({schemaVersion: 1}, {
      signal: context().signal,
      onProgress(value) {
        expect(completed).toBeFalse()
        recordProgress(value)
        if (progress.length === 1) writeFileSync(join(fixture.stateRoot, "continue-startup"), readyOrder)
      },
    }).then(value => { completed = true; return value })
    expect(first).toMatchObject({status: "success", server: "running"})
    expect(progress.map(value => value.phase)).toEqual(["catalog", "ready"])
    expect(progress.every(value => Number.isFinite(value.at))).toBeTrue()
    if (readyOrder === "late") {
      writeFileSync(join(fixture.stateRoot, "emit-ready"), "ready")
      const deadline = Date.now() + 5_000
      while (!existsSync(join(fixture.stateRoot, "ready-emitted"))) {
        if (Date.now() >= deadline) throw new Error("Fixture did not emit late ready")
        await Bun.sleep(10)
      }
    }
    const record = State.readExternalStorybookServerRecord(State.externalStorybookServerStatePath())
    const reused = await app.ensure({schemaVersion: 1}, {
      signal: context().signal,
      onProgress: value => { recordProgress(value) },
    })
    expect(reused.instanceId).toBe(first.instanceId)
    expect(State.readExternalStorybookServerRecord(State.externalStorybookServerStatePath()).pid).toBe(record.pid)
    expect(progress).toHaveLength(2)
  } finally {
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

test("отдельный status получает стадию запуска без progress callback", async () => {
  const fixture = createLazyStartupFixture()
  const previousRoot = Bun.env.STORYBOOK_STATE_ROOT
  const previousFixture = Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE
  Bun.env.STORYBOOK_STATE_ROOT = fixture.stateRoot
  Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE = "isolated"
  const options = {toolRoot: fixture.toolRoot, daemonEntryPath: join(import.meta.dir, "fixtures/progress-daemon.ts"), legacyStatePaths: []}
  const app = createApp(options)
  const observer = createApp(options)
  const cancellation = new AbortController()
  const pending = app.ensure({schemaVersion: 1}, {signal: cancellation.signal}).then(value => ({value}), error => ({error}))
  try {
    let state: any
    const deadline = Date.now() + 5000
    do {
      state = await observer.status({schemaVersion: 1}, {signal: new AbortController().signal})
      if (state.startup?.phase === "catalog") break
      if (Date.now() > deadline) throw new Error("Startup stage missing from status")
      await Bun.sleep(10)
    } while (true)
    expect(state).toMatchObject({status: "success", server: "starting", startup: {phase: "catalog", at: expect.any(Number)}})
    expect(State.readExternalStorybookStartupProgress(import.meta.dir)).toBeNull()
    writeFileSync(join(fixture.stateRoot, "continue-startup"), "early")
    expect(await pending).toHaveProperty("value")
    expect((await observer.status({schemaVersion: 1}, {signal: new AbortController().signal})).server).toBe("running")
    expect(State.readExternalStorybookStartupProgress(fixture.toolRoot)).toBeNull()
  } finally {
    cancellation.abort()
    await pending
    try { await app.stop({schemaVersion: 1, confirm: true}, {signal: new AbortController().signal}) } finally {
      if (previousRoot === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
      else Bun.env.STORYBOOK_STATE_ROOT = previousRoot
      if (previousFixture === undefined) delete Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE
      else Bun.env.STORYBOOK_LAZY_STARTUP_FIXTURE = previousFixture
      fixture.dispose()
    }
  }
}, 15000)
