import StorybookAppOwner from "@storybook/app"
const createExternalStorybookController = StorybookAppOwner
import ServerState from "@app-server/state"
const {createExternalStorybookServerRecord, externalStorybookServerStatePath, externalStorybookMigrationStatePath, readExternalStorybookMigrationRecord, readExternalStorybookServerRecord, processExists, writeExternalStorybookMigrationRecord, writeExternalStorybookServerRecord} = ServerState
import {afterAll, beforeAll, beforeEach, describe, expect, test} from "bun:test"
import {cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
const stateRoot = mkdtempSync(join(tmpdir(), "storybook-controller-"))
const previousConfigRoot = Bun.env.STORYBOOK_CONFIG_ROOT
const previousStateRoot = Bun.env.STORYBOOK_STATE_ROOT
const project = join(stateRoot, "project")
const fixture = join(project, "standalone")
const fixtureSource = join(import.meta.dir, "../../repo/discovery/fixtures/valid/standalone")
const toolRoot = realpathSync(join(import.meta.dir, "../.."))
const context = () => ({signal: AbortSignal.timeout(120_000)})

describe.serial("external Storybook shared controller", () => {
  beforeAll(() => {
    mkdirSync(project, {recursive: true})
    cpSync(fixtureSource, fixture, {recursive: true})
    writeFileSync(join(project, "package.json"), JSON.stringify({name: "controller-project", private: true}))
    writeFileSync(join(project, ".gitmodules"), '[submodule "standalone"]\n\tpath = standalone\n\turl = git@example.test:standalone.git\n')
    initializeFixtureGit(project)
    initializeFixtureGit(fixture)
    registerFixtureRepo(fixture, "standalone")
    mkdirSync(join(stateRoot, "config"), {recursive: true})
    writeFileSync(join(stateRoot, "config", "projects.json"), JSON.stringify([join(stateRoot, "retired-root")]))
    Bun.env.STORYBOOK_CONFIG_ROOT = join(stateRoot, "config")
    Bun.env.STORYBOOK_STATE_ROOT = stateRoot
  })

  beforeEach(() => {
    if (!existsSync(externalStorybookServerStatePath()) && !existsSync(externalStorybookMigrationStatePath())) {
      writeExternalStorybookMigrationRecord({toolRoot, declarations: [realpathSync(fixture)]})
    }
  })

  afterAll(async () => {
    const controller = createExternalStorybookController()
    try {
      await controller.stop({schemaVersion: 1, confirm: true}, context())
    } catch {
      // A failed test may stop the isolated daemon first.
    }
    if (previousConfigRoot === undefined) delete Bun.env.STORYBOOK_CONFIG_ROOT
    else Bun.env.STORYBOOK_CONFIG_ROOT = previousConfigRoot
    if (previousStateRoot === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
    else Bun.env.STORYBOOK_STATE_ROOT = previousStateRoot
    rmSync(stateRoot, {recursive: true, force: true})
  })

  test("starts once, reuses across controllers and exposes graph operations without CLI", async () => {
    const first = createExternalStorybookController()
    const ensured = await first.ensure({schemaVersion: 1}, context())
    expect(ensured).toMatchObject({status: "success", server: "running"})
    expect(ensured.origin).toMatch(/^storybook-origin-v1_[A-Za-z0-9_-]{43}$/u)
    expect(ensured).not.toHaveProperty("views")
    expect(JSON.stringify(ensured)).not.toContain("controlToken")
    expect(JSON.stringify(ensured)).not.toContain("127.0.0.1")

    const second = createExternalStorybookController()
    const reused = await second.ensure({schemaVersion: 1}, context())
    expect(reused.instanceId).toBe(ensured.instanceId)
    expect(reused.origin).toBe(ensured.origin)
    expect(reused).not.toHaveProperty("views")

    const statePath = externalStorybookServerStatePath()
    const running = readExternalStorybookServerRecord(statePath)
    expect(running.attachedDeclarations, "Состав сессии читается из .gitmodules, сохранённый старый список не участвует")
      .toEqual([realpathSync(fixture)])
    const runningPort = new URL(running.origin).port
    const orphan = join(stateRoot, "artifacts", "orphan-package", "old-revision", "entry.js")
    mkdirSync(join(orphan, ".."), {recursive: true})
    writeFileSync(orphan, "stale")
    await second.stop({schemaVersion: 1, confirm: true}, context())
    const restarted = await second.ensure({schemaVersion: 1}, context())
    expect(restarted.instanceId).not.toBe(ensured.instanceId)
    const restartedRecord = readExternalStorybookServerRecord(statePath)
    expect(new URL(restartedRecord.origin).port).toBe(runningPort)
    expect(existsSync(orphan)).toBeFalse()

    const search = await second.search({
      schemaVersion: 1,
      query: "Standalone",
      packageId: "@fixture/standalone",
    }, context())
    expect(search.status).toBe("success")
    expect((search.results as readonly unknown[]).length).toBeGreaterThan(0)

    const shared = await second.check({
      schemaVersion: 1,
      scope: "storybook:shared",
    }, {signal: AbortSignal.timeout(480_000)})
    expect(shared, "Общая оболочка готовится отдельной явной операцией перед проверкой пакета")
      .toMatchObject({status: "success", ok: true, published: true})

    const checked = await second.check({
      schemaVersion: 1,
      scope: "@fixture/standalone",
    }, context())
    expect(checked).toMatchObject({status: "success", ok: true})
    const waited = await second.wait({
      schemaVersion: 1,
      packageId: "@fixture/standalone",
      condition: "built",
      timeoutMs: 1_000,
    }, context())
    expect(waited).toMatchObject({status: "success", condition: "built"})
    expect(JSON.stringify(waited)).not.toContain("dependencyRealpaths")
    expect(JSON.stringify(waited)).not.toContain("entryRelativePath")
    expect(JSON.stringify(waited)).not.toContain("revisions")

    const stopped = await second.stop({schemaVersion: 1, confirm: true}, context())
    expect(stopped).toMatchObject({status: "success", stopped: true})
  }, 480_000 + 120_000 + 60_000)

  test("durably adopts the pre-capability TMPDIR daemon after an interrupted replacement", async () => {
    const declarationPath = realpathSync(join(fixture, "package.json"))
    const legacyStatePath = join(stateRoot, "legacy-tmp", "server.json")
    const legacy = Bun.spawn([
      process.execPath,
      join(import.meta.dir, "fixtures/legacy-daemon.ts"),
      legacyStatePath,
      toolRoot,
      declarationPath,
      "0",
    ], {cwd: toolRoot, stdout: "pipe", stderr: "pipe"})
    await waitForPath(legacyStatePath)
    const legacyRecord = readExternalStorybookServerRecord(legacyStatePath)
    expect(legacyRecord.controlToken).toBe("")

    const marker = join(stateRoot, "legacy-slow-daemon.pid")
    const previousMarker = Bun.env.STORYBOOK_SLOW_DAEMON_MARKER
    Bun.env.STORYBOOK_SLOW_DAEMON_MARKER = marker
    try {
      const interrupted = createExternalStorybookController({
        daemonEntryPath: join(import.meta.dir, "fixtures/slow-daemon.ts"),
        legacyStatePaths: [legacyStatePath],
      })
      await interruptStartedDaemon(interrupted, marker)
    } finally {
      if (previousMarker === undefined) delete Bun.env.STORYBOOK_SLOW_DAEMON_MARKER
      else Bun.env.STORYBOOK_SLOW_DAEMON_MARKER = previousMarker
    }
    expect(await legacy.exited).toBe(0)
    const journal = readExternalStorybookMigrationRecord(externalStorybookMigrationStatePath())
    expect(journal?.declarations).toContain(declarationPath)
    expect(journal?.preferredPort).toBe(Number(new URL(legacyRecord.origin).port))

    const controller = createExternalStorybookController({legacyStatePaths: [legacyStatePath]})
    const ensured = await controller.ensure({schemaVersion: 1}, context())
    const migrated = readExternalStorybookServerRecord(externalStorybookServerStatePath())

    expect(ensured).toMatchObject({status: "success", server: "running"})
    expect(migrated.pid).not.toBe(legacyRecord.pid)
    expect(new URL(migrated.origin).port).toBe(new URL(legacyRecord.origin).port)
    expect(migrated.attachedDeclarations).toContain(realpathSync(fixture))
    expect(await new Response(legacy.stderr).text()).toBe("")
    expect(readExternalStorybookMigrationRecord(externalStorybookMigrationStatePath())).toBeNull()
    await controller.stop({schemaVersion: 1, confirm: true}, context())
  }, 40_000)

  test("refuses a user-global state record owned by another checkout", async () => {
    const foreignRoot = join(stateRoot, "foreign-checkout")
    mkdirSync(foreignRoot, {recursive: true})
    const statePath = externalStorybookServerStatePath()
    const foreign = createExternalStorybookServerRecord({
      toolRoot: foreignRoot,
      origin: "http://127.0.0.1:65534",

    })
    writeExternalStorybookServerRecord(statePath, foreign)

    const controller = createExternalStorybookController()
    await expect(controller.ensure({schemaVersion: 1}, context()))
      .rejects.toThrow("belongs to another checkout")
    expect(readExternalStorybookServerRecord(statePath)).toEqual(foreign)
    rmSync(statePath, {force: true})
  })

  test("falls back to an automatic port when a preserved legacy port is occupied", async () => {
    const occupied = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("occupied")})
    try {
      const declarationPath = realpathSync(join(fixture, "package.json"))
      const current = createExternalStorybookServerRecord({
        toolRoot,
        origin: occupied.url.origin,

        attachedDeclarations: [declarationPath],
      })
      writeExternalStorybookServerRecord(externalStorybookServerStatePath(), Object.freeze({
        ...current,
        pid: 999_999,
        processStart: "dead",
      }))
      const controller = createExternalStorybookController({legacyStatePaths: []})

      const ensured = await controller.ensure({schemaVersion: 1}, context())
      const running = readExternalStorybookServerRecord(externalStorybookServerStatePath())

      expect(ensured).toMatchObject({status: "success", server: "running"})
      expect(new URL(running.origin).port).not.toBe(new URL(occupied.url).port)
      expect(running.attachedDeclarations).toContain(realpathSync(fixture))
      await controller.stop({schemaVersion: 1, confirm: true}, context())
    } finally {
      occupied.stop(true)
    }
  }, 40_000)

  test("terminates the exact daemon child when startup is aborted before publication", async () => {
    const marker = join(stateRoot, "slow-daemon.pid")
    const previousMarker = Bun.env.STORYBOOK_SLOW_DAEMON_MARKER
    Bun.env.STORYBOOK_SLOW_DAEMON_MARKER = marker
    try {
      const controller = createExternalStorybookController({
        daemonEntryPath: join(import.meta.dir, "fixtures/slow-daemon.ts"),
        legacyStatePaths: [],
      })
      await interruptStartedDaemon(controller, marker)
      await waitForPath(marker)
      const pid = Number((await Bun.file(marker).text()).trim())
      expect(processExists(pid)).toBeFalse()
      expect(existsSync(`${externalStorybookServerStatePath()}.start.lock`)).toBeFalse()
      expect(existsSync(externalStorybookServerStatePath())).toBeFalse()
    } finally {
      if (previousMarker === undefined) delete Bun.env.STORYBOOK_SLOW_DAEMON_MARKER
      else Bun.env.STORYBOOK_SLOW_DAEMON_MARKER = previousMarker
    }
  })

  test("allows catalog preparation beyond the old twenty-second startup cutoff", async () => {
    const controller = createExternalStorybookController({
      daemonEntryPath: join(import.meta.dir, "fixtures/delayed-ready-daemon.ts"),
      legacyStatePaths: [],
    })
    try {
      const result = await controller.ensure({schemaVersion: 1}, {
        signal: AbortSignal.timeout(60_000),
      })
      expect(result).toMatchObject({status: "success", server: "running"})
    } finally {
      await controller.stop({schemaVersion: 1, confirm: true}, context())
    }
  }, 65_000)

  test("drains a full daemon stderr pipe and reports its startup phase", async () => {
    const marker = join(stateRoot, "stderr-flood-daemon.pid")
    const previousMarker = Bun.env.STORYBOOK_STDERR_FLOOD_DAEMON_MARKER
    Bun.env.STORYBOOK_STDERR_FLOOD_DAEMON_MARKER = marker
    try {
      const controller = createExternalStorybookController({
        daemonEntryPath: join(import.meta.dir, "fixtures/stderr-flood-daemon.ts"),
        legacyStatePaths: [],
      })
      await expect(controller.ensure({schemaVersion: 1}, {
        signal: AbortSignal.timeout(3_000),
      })).rejects.toThrow("Storybook startup: catalog")
      await waitForPath(marker)
      const pid = Number((await Bun.file(marker).text()).trim())
      expect(processExists(pid)).toBeFalse()
      expect(existsSync(`${externalStorybookServerStatePath()}.start.lock`)).toBeFalse()
      expect(existsSync(externalStorybookServerStatePath())).toBeFalse()
    } finally {
      if (previousMarker === undefined) delete Bun.env.STORYBOOK_STDERR_FLOOD_DAEMON_MARKER
      else Bun.env.STORYBOOK_STDERR_FLOOD_DAEMON_MARKER = previousMarker
    }
  })

  test("сохраняет runtime journal, но восстанавливает состав из текущего .gitmodules", async () => {
    const declarationPath = realpathSync(fixture)
    const controller = createExternalStorybookController({legacyStatePaths: []})
    await controller.ensure({schemaVersion: 1}, context())
    await controller.stop({schemaVersion: 1, confirm: true}, context())

    const marker = join(stateRoot, "upgrade-slow-daemon.pid")
    const previousMarker = Bun.env.STORYBOOK_SLOW_DAEMON_MARKER
    Bun.env.STORYBOOK_SLOW_DAEMON_MARKER = marker
    try {
      const interrupted = createExternalStorybookController({
        daemonEntryPath: join(import.meta.dir, "fixtures/slow-daemon.ts"),
        legacyStatePaths: [],
      })
      await interruptStartedDaemon(interrupted, marker)
    } finally {
      if (previousMarker === undefined) delete Bun.env.STORYBOOK_SLOW_DAEMON_MARKER
      else Bun.env.STORYBOOK_SLOW_DAEMON_MARKER = previousMarker
    }
    expect(readExternalStorybookMigrationRecord(externalStorybookMigrationStatePath())?.declarations)
      .toContain(declarationPath)

    const nextFixture = join(project, "next-standalone")
    cpSync(fixtureSource, nextFixture, {recursive: true})
    initializeFixtureGit(nextFixture)
    registerFixtureRepo(nextFixture, "next-standalone")
    writeFileSync(join(project, ".gitmodules"), '[submodule "standalone"]\n\tpath = next-standalone\n\turl = git@example.test:standalone.git\n')
    const recovered = await createExternalStorybookController({legacyStatePaths: []})
      .ensure({schemaVersion: 1}, context())
    expect(recovered).toMatchObject({status: "success", server: "running"})
    expect(readExternalStorybookServerRecord(externalStorybookServerStatePath()).attachedDeclarations)
      .toEqual([realpathSync(nextFixture)])
    expect(readExternalStorybookMigrationRecord(externalStorybookMigrationStatePath())).toBeNull()
    await controller.stop({schemaVersion: 1, confirm: true}, context())
  }, 40_000)
})

function initializeFixtureGit(root: string): void {
  const result = Bun.spawnSync(["git", "-C", root, "init", "--quiet"], {stdout: "ignore", stderr: "pipe"})
  if (result.exitCode !== 0) throw new Error(`Fixture Git init failed: ${result.stderr.toString()}`)
}

function registerFixtureRepo(root: string, path: string): void {
  for (const args of [
    ["-C", root, "add", "--", "package.json", "README.md"],
    ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Fixture"],
    ["-C", project, "add", "--", path],
  ]) {
    const result = Bun.spawnSync(["git", ...args], {stdout: "ignore", stderr: "pipe"})
    if (result.exitCode !== 0) throw new Error(`Fixture Git registration failed: ${result.stderr.toString()}`)
  }
}

async function waitForPath(path: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return
    await Bun.sleep(10)
  }
  throw new Error(`fixture did not publish state: ${path}`)
}

/** Прерывает именно замену запущенного процесса, независимо от времени чтения его версии. */
async function interruptStartedDaemon(
  controller: ReturnType<typeof createExternalStorybookController>,
  marker: string,
): Promise<void> {
  const lifetime = new AbortController()
  const pending = controller.ensure({schemaVersion: 1}, {signal: lifetime.signal})
  try {
    await Promise.race([waitForPath(marker, 10_000), pending])
  } finally {
    lifetime.abort(new DOMException("Fixture startup interrupted", "TimeoutError"))
  }
  await expect(pending).rejects.toMatchObject({name: "TimeoutError"})
}
