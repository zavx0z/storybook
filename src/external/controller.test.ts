import {afterAll, beforeAll, describe, expect, test} from "bun:test"
import {existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {createExternalStorybookController} from "./controller.ts"
import {externalStorybookImplementationDigest} from "./implementation-digest.ts"
import {
  createExternalStorybookServerRecord,
  externalStorybookServerStatePath,
  externalStorybookMigrationStatePath,
  readExternalStorybookMigrationRecord,
  readExternalStorybookServerRecord,
  processExists,
  writeExternalStorybookServerRecord,
} from "./server-state.ts"

const stateRoot = mkdtempSync(join(tmpdir(), "storybook-controller-"))
const previousStateRoot = Bun.env.STORYBOOK_STATE_ROOT
const fixture = join(import.meta.dir, "fixtures", "valid", "standalone")
const context = () => ({signal: AbortSignal.timeout(30_000)})

describe.serial("external Storybook shared controller", () => {
  beforeAll(() => {
    Bun.env.STORYBOOK_STATE_ROOT = stateRoot
  })

  afterAll(async () => {
    const controller = createExternalStorybookController()
    try {
      await controller.stop({schemaVersion: 1, confirm: true}, context())
    } catch {
      // A failed test may stop the isolated daemon first.
    }
    if (previousStateRoot === undefined) delete Bun.env.STORYBOOK_STATE_ROOT
    else Bun.env.STORYBOOK_STATE_ROOT = previousStateRoot
    rmSync(stateRoot, {recursive: true, force: true})
  })

  test("starts once, reuses across controllers and exposes graph operations without CLI", async () => {
    const first = createExternalStorybookController()
    const ensured = await first.ensure({schemaVersion: 1, roots: [fixture]}, context())
    expect(ensured).toMatchObject({status: "success", server: "running"})
    expect(ensured.origin).toMatch(/^storybook-origin-v1_[A-Za-z0-9_-]{43}$/u)
    expect(ensured).not.toHaveProperty("views")
    expect(JSON.stringify(ensured)).not.toContain("controlToken")
    expect(JSON.stringify(ensured)).not.toContain("127.0.0.1")

    const second = createExternalStorybookController()
    const reused = await second.ensure({schemaVersion: 1, roots: [fixture]}, context())
    expect(reused.instanceId).toBe(ensured.instanceId)
    expect(reused.origin).toBe(ensured.origin)
    expect(reused).not.toHaveProperty("views")

    const statePath = externalStorybookServerStatePath()
    const running = readExternalStorybookServerRecord(statePath)
    const runningPort = new URL(running.origin).port
    const orphan = join(stateRoot, "artifacts", "orphan-package", "old-revision", "entry.js")
    mkdirSync(join(orphan, ".."), {recursive: true})
    writeFileSync(orphan, "stale")
    writeExternalStorybookServerRecord(statePath, Object.freeze({
      ...running,
      implementationDigest: "0".repeat(64),
    }))
    expect(await second.status({schemaVersion: 1}, context())).toMatchObject({
      status: "success",
      server: "stale",
    })
    const upgraded = await second.ensure({schemaVersion: 1, roots: []}, context())
    expect(upgraded.instanceId).not.toBe(ensured.instanceId)
    const upgradedRecord = readExternalStorybookServerRecord(statePath)
    expect(new URL(upgradedRecord.origin).port).toBe(runningPort)
    expect(upgradedRecord.implementationDigest).toBe(
      externalStorybookImplementationDigest(join(import.meta.dir, "../..")),
    )
    expect(existsSync(orphan)).toBeFalse()

    const search = await second.search({
      schemaVersion: 1,
      query: "Standalone",
      packageId: "@fixture/standalone",
    }, context())
    expect(search.status).toBe("success")
    expect((search.results as readonly unknown[]).length).toBeGreaterThan(0)

    const checked = await second.check({
      schemaVersion: 1,
      scope: "@fixture/standalone",
      live: false,
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
  }, 40_000)

  test("durably adopts the pre-capability TMPDIR daemon after an interrupted replacement", async () => {
    const toolRoot = realpathSync(join(import.meta.dir, "../.."))
    const declarationPath = realpathSync(join(fixture, ".storybook", "manifest.json"))
    const legacyStatePath = join(stateRoot, "legacy-tmp", "server.json")
    const legacy = Bun.spawn([
      process.execPath,
      join(import.meta.dir, "fixtures", "legacy-daemon.ts"),
      legacyStatePath,
      toolRoot,
      declarationPath,
      "0",
    ], {cwd: toolRoot, stdout: "pipe", stderr: "pipe"})
    await waitForPath(legacyStatePath)
    const legacyRecord = readExternalStorybookServerRecord(legacyStatePath)
    expect(legacyRecord.implementationDigest).toBeUndefined()

    const marker = join(stateRoot, "legacy-slow-daemon.pid")
    const previousMarker = Bun.env.STORYBOOK_SLOW_DAEMON_MARKER
    Bun.env.STORYBOOK_SLOW_DAEMON_MARKER = marker
    try {
      const interrupted = createExternalStorybookController({
        daemonEntryPath: join(import.meta.dir, "fixtures", "slow-daemon.ts"),
        legacyStatePaths: [legacyStatePath],
      })
      await expect(interrupted.ensure({schemaVersion: 1, roots: []}, {
        signal: AbortSignal.timeout(300),
      })).rejects.toMatchObject({name: "TimeoutError"})
    } finally {
      if (previousMarker === undefined) delete Bun.env.STORYBOOK_SLOW_DAEMON_MARKER
      else Bun.env.STORYBOOK_SLOW_DAEMON_MARKER = previousMarker
    }
    expect(await legacy.exited).toBe(0)
    const journal = readExternalStorybookMigrationRecord(externalStorybookMigrationStatePath())
    expect(journal?.declarations).toContain(declarationPath)
    expect(journal?.preferredPort).toBe(Number(new URL(legacyRecord.origin).port))

    const controller = createExternalStorybookController({legacyStatePaths: [legacyStatePath]})
    const ensured = await controller.ensure({schemaVersion: 1, roots: []}, context())
    const migrated = readExternalStorybookServerRecord(externalStorybookServerStatePath())

    expect(ensured).toMatchObject({status: "success", server: "running"})
    expect(migrated.pid).not.toBe(legacyRecord.pid)
    expect(new URL(migrated.origin).port).toBe(new URL(legacyRecord.origin).port)
    expect(migrated.attachedDeclarations).toContain(declarationPath)
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
      implementationDigest: externalStorybookImplementationDigest(join(import.meta.dir, "../..")),
    })
    writeExternalStorybookServerRecord(statePath, foreign)

    const controller = createExternalStorybookController()
    await expect(controller.ensure({schemaVersion: 1, roots: []}, context()))
      .rejects.toThrow("belongs to another checkout")
    expect(readExternalStorybookServerRecord(statePath)).toEqual(foreign)
    rmSync(statePath, {force: true})
  })

  test("falls back to an automatic port when a preserved legacy port is occupied", async () => {
    const occupied = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("occupied")})
    try {
      const declarationPath = realpathSync(join(fixture, ".storybook", "manifest.json"))
      const current = createExternalStorybookServerRecord({
        toolRoot: join(import.meta.dir, "../.."),
        origin: occupied.url.origin,
        implementationDigest: "0".repeat(64),
        attachedDeclarations: [declarationPath],
      })
      writeExternalStorybookServerRecord(externalStorybookServerStatePath(), Object.freeze({
        ...current,
        pid: 999_999,
        processStart: "dead",
      }))
      const controller = createExternalStorybookController({legacyStatePaths: []})

      const ensured = await controller.ensure({schemaVersion: 1, roots: []}, context())
      const running = readExternalStorybookServerRecord(externalStorybookServerStatePath())

      expect(ensured).toMatchObject({status: "success", server: "running"})
      expect(new URL(running.origin).port).not.toBe(new URL(occupied.url).port)
      expect(running.attachedDeclarations).toContain(declarationPath)
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
        daemonEntryPath: join(import.meta.dir, "fixtures", "slow-daemon.ts"),
        legacyStatePaths: [],
      })
      await expect(controller.ensure({schemaVersion: 1, roots: []}, {
        signal: AbortSignal.timeout(300),
      })).rejects.toMatchObject({name: "TimeoutError"})
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

  test("keeps current declarations in the journal across an interrupted implementation upgrade", async () => {
    const declarationPath = realpathSync(join(fixture, ".storybook", "manifest.json"))
    const controller = createExternalStorybookController({legacyStatePaths: []})
    await controller.ensure({schemaVersion: 1, roots: [fixture]}, context())
    const running = readExternalStorybookServerRecord(externalStorybookServerStatePath())
    writeExternalStorybookServerRecord(externalStorybookServerStatePath(), Object.freeze({
      ...running,
      implementationDigest: "0".repeat(64),
    }))

    const marker = join(stateRoot, "upgrade-slow-daemon.pid")
    const previousMarker = Bun.env.STORYBOOK_SLOW_DAEMON_MARKER
    Bun.env.STORYBOOK_SLOW_DAEMON_MARKER = marker
    try {
      const interrupted = createExternalStorybookController({
        daemonEntryPath: join(import.meta.dir, "fixtures", "slow-daemon.ts"),
        legacyStatePaths: [],
      })
      await expect(interrupted.ensure({schemaVersion: 1, roots: []}, {
        signal: AbortSignal.timeout(300),
      })).rejects.toMatchObject({name: "TimeoutError"})
    } finally {
      if (previousMarker === undefined) delete Bun.env.STORYBOOK_SLOW_DAEMON_MARKER
      else Bun.env.STORYBOOK_SLOW_DAEMON_MARKER = previousMarker
    }
    expect(readExternalStorybookMigrationRecord(externalStorybookMigrationStatePath())?.declarations)
      .toContain(declarationPath)

    const recovered = await createExternalStorybookController({legacyStatePaths: []})
      .ensure({schemaVersion: 1, roots: []}, context())
    expect(recovered).toMatchObject({status: "success", server: "running"})
    expect(readExternalStorybookServerRecord(externalStorybookServerStatePath()).attachedDeclarations)
      .toContain(declarationPath)
    expect(readExternalStorybookMigrationRecord(externalStorybookMigrationStatePath())).toBeNull()
    await controller.stop({schemaVersion: 1, confirm: true}, context())
  }, 40_000)
})

async function waitForPath(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (existsSync(path)) return
    await Bun.sleep(10)
  }
  throw new Error(`fixture did not publish state: ${path}`)
}
