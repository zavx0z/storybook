import {afterEach, describe, expect, test} from "bun:test"
import {existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync} from "node:fs"
import {readFile} from "node:fs/promises"
import {homedir, tmpdir} from "node:os"
import {join, resolve} from "node:path"
import {
  EXTERNAL_STORYBOOK_SERVER_PROTOCOL,
  acquireExternalStorybookStartLease,
  assertExternalStorybookStartLease,
  createExternalStorybookServerRecord,
  clearExternalStorybookMigrationRecord,
  externalStorybookStateRoot,
  externalStorybookLegacyStatePaths,
  readExternalStorybookMigrationRecord,
  inspectExternalStorybookServer,
  projectExternalStorybookServerRecord,
  publishExternalStorybookStartCandidate,
  readExternalStorybookServerRecord,
  writeExternalStorybookServerRecord,
  writeExternalStorybookMigrationRecord,
  writeExternalStorybookStartCandidate,
} from "./server-state.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("external Storybook server state", () => {
  test("uses one canonical user cache root independent from transport TMPDIR", () => {
    const previous = Bun.env.STORYBOOK_STATE_ROOT
    delete Bun.env.STORYBOOK_STATE_ROOT
    try {
      expect(externalStorybookStateRoot()).toBe(resolve(homedir(), "Library", "Caches", "zavx0z-external-storybook"))
      expect(externalStorybookLegacyStatePaths()).toContain("/tmp/zavx0z-external-storybook/server.json")
      expect(externalStorybookLegacyStatePaths()).not.toContain(join(externalStorybookStateRoot(), "server.json"))
    } finally {
      if (previous !== undefined) Bun.env.STORYBOOK_STATE_ROOT = previous
    }
  })

  test("writes and reads one exact loopback server identity", () => {
    const root = temporaryRoot()
    const path = join(root, "state", "server.json")
    const record = createExternalStorybookServerRecord({
      toolRoot: import.meta.dir,
      origin: "http://127.0.0.1:43210",
      implementationDigest: "a".repeat(64),
      attachedDeclarations: [import.meta.path],
    })
    writeExternalStorybookServerRecord(path, record)
    expect(readExternalStorybookServerRecord(path)).toEqual(record)
    expect(record.protocol).toBe(EXTERNAL_STORYBOOK_SERVER_PROTOCOL)
    expect(record.pid).toBe(process.pid)
    expect(record.instanceId).toMatch(/^[a-f0-9-]{36}$/u)
    expect(record.controlToken).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(record.implementationDigest).toBe("a".repeat(64))
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(join(root, "state")).mode & 0o777).toBe(0o700)

    const publicRecord = projectExternalStorybookServerRecord(record)
    expect(Object.hasOwn(publicRecord, "controlToken")).toBeFalse()
    expect(JSON.stringify(publicRecord)).not.toContain(record.controlToken)
    expect(publicRecord.instanceId).toBe(record.instanceId)
    expect(publicRecord.implementationDigest).toBe(record.implementationDigest)
  })

  test("persists a private replacement journal until the new daemon is published", () => {
    const root = temporaryRoot()
    const path = join(root, "state", "migration.json")
    const record = writeExternalStorybookMigrationRecord({
      toolRoot: import.meta.dir,
      declarations: [import.meta.path],
      preferredPort: 43_210,
    }, path)
    expect(readExternalStorybookMigrationRecord(path)).toEqual(record)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(clearExternalStorybookMigrationRecord(import.meta.dir, path)).toBeTrue()
    expect(readExternalStorybookMigrationRecord(path)).toBeNull()
  })

  test("fails closed for foreign origins and unknown fields", () => {
    expect(() => createExternalStorybookServerRecord({
      toolRoot: import.meta.dir,
      origin: "https://example.com",
      implementationDigest: "a".repeat(64),
    })).toThrow("loopback HTTP origin")

    const root = temporaryRoot()
    const path = join(root, "server.json")
    writeFileSync(path, JSON.stringify({
      protocol: EXTERNAL_STORYBOOK_SERVER_PROTOCOL,
      extra: true,
    }))
    expect(() => readExternalStorybookServerRecord(path)).toThrow("unknown or missing fields")
  })

  test("normalizes the exact pre-capability legacy shape so its daemon can be replaced", () => {
    const root = temporaryRoot()
    const path = join(root, "server.json")
    const current = createExternalStorybookServerRecord({
      toolRoot: import.meta.dir,
      origin: "http://127.0.0.1:43210",
      implementationDigest: "b".repeat(64),
    })
    const {
      implementationDigest: _implementationDigest,
      instanceId: _instanceId,
      controlToken: _controlToken,
      ...legacy
    } = current
    writeFileSync(path, `${JSON.stringify(legacy)}\n`)
    const adopted = readExternalStorybookServerRecord(path)
    expect(adopted.implementationDigest).toBeUndefined()
    expect(adopted.instanceId).toMatch(/^[a-f0-9-]{36}$/u)
    expect(adopted.controlToken).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(readExternalStorybookServerRecord(path)).toEqual(adopted)
    expect(() => writeExternalStorybookServerRecord(path, adopted)).toThrow(
      "Refusing to publish a legacy external Storybook state",
    )
  })

  test("reports missing state without adopting a foreign process", async () => {
    const inspection = await inspectExternalStorybookServer(join(temporaryRoot(), "missing.json"))
    expect(inspection).toEqual({state: "stopped", record: null, reason: null, replaceable: true})
  })

  test("admits only one concurrent server start owner", () => {
    const root = temporaryRoot()
    const path = join(root, "server.json")
    const first = acquireExternalStorybookStartLease(path)
    expect(statSync(first.path).mode & 0o777).toBe(0o700)
    expect(statSync(join(first.path, "owner.json")).mode & 0o777).toBe(0o600)
    expect(statSync(root).mode & 0o777).toBe(0o700)
    expect(() => acquireExternalStorybookStartLease(path)).toThrow("already in progress")
    first.release()
    const second = acquireExternalStorybookStartLease(path)
    expect(() => assertExternalStorybookStartLease(second.path, first.token)).toThrow("superseded")
    expect(() => assertExternalStorybookStartLease(second.path, second.token)).not.toThrow()
    second.release()
  })

  test("prevents a superseded daemon candidate from publishing canonical state", () => {
    const root = temporaryRoot()
    const statePath = join(root, "server.json")
    const first = acquireExternalStorybookStartLease(statePath)
    const record = createExternalStorybookServerRecord({
      toolRoot: import.meta.dir,
      origin: "http://127.0.0.1:43210",
      implementationDigest: "c".repeat(64),
    })
    writeExternalStorybookStartCandidate(first, record)
    first.release()
    const second = acquireExternalStorybookStartLease(statePath)

    expect(() => publishExternalStorybookStartCandidate({
      lease: first,
      statePath,
      toolRoot: import.meta.dir,
      childPid: record.pid,
    })).toThrow("superseded")
    expect(existsSync(statePath)).toBeFalse()

    writeExternalStorybookStartCandidate(second, record)
    expect(publishExternalStorybookStartCandidate({
      lease: second,
      statePath,
      toolRoot: import.meta.dir,
      childPid: record.pid,
    })).toEqual(record)
    expect(readExternalStorybookServerRecord(statePath)).toEqual(record)
    second.release()
  })

  test("atomically serializes two processes reclaiming the same stale start lease", async () => {
    const root = temporaryRoot()
    const statePath = join(root, "server.json")
    const lockPath = `${statePath}.start.lock`
    mkdirSync(lockPath, {recursive: true})
    writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
      pid: 999_999,
      processStart: "dead",
      token: "stale",
    }))
    const events = join(root, "events.log")
    const worker = join(import.meta.dir, "fixtures", "start-lease-worker.ts")
    const children = ["first", "second"].map((label) => Bun.spawn([
      process.execPath,
      worker,
      statePath,
      events,
      label,
      "100",
    ], {cwd: join(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe"}))
    const outcomes = await Promise.all(children.map(async (child) => ({
      exitCode: await child.exited,
      stderr: await new Response(child.stderr).text(),
    })))
    expect(outcomes).toEqual([{exitCode: 0, stderr: ""}, {exitCode: 0, stderr: ""}])
    const lines = (await readFile(events, "utf8")).trim().split("\n")
    expect(lines).toHaveLength(4)
    expect(lines[0]!.endsWith(":acquired")).toBeTrue()
    expect(lines[1]).toBe(lines[0]!.replace(":acquired", ":released"))
    expect(lines[2]!.endsWith(":acquired")).toBeTrue()
    expect(lines[3]).toBe(lines[2]!.replace(":acquired", ":released"))
    expect(lines[0]!.split(":")[0]).not.toBe(lines[2]!.split(":")[0])
  })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "external-storybook-state-test-"))
  roots.push(root)
  return root
}
