import {afterEach, describe, expect, test} from "bun:test"
import {mkdtempSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {
  EXTERNAL_STORYBOOK_SERVER_PROTOCOL,
  acquireExternalStorybookStartLease,
  createExternalStorybookServerRecord,
  inspectExternalStorybookServer,
  readExternalStorybookServerRecord,
  writeExternalStorybookServerRecord,
} from "./server-state.ts"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("external Storybook server state", () => {
  test("writes and reads one exact loopback server identity", () => {
    const root = temporaryRoot()
    const path = join(root, "state", "server.json")
    const record = createExternalStorybookServerRecord({
      toolRoot: import.meta.dir,
      origin: "http://127.0.0.1:43210",
      attachedDeclarations: [import.meta.path],
    })
    writeExternalStorybookServerRecord(path, record)
    expect(readExternalStorybookServerRecord(path)).toEqual(record)
    expect(record.protocol).toBe(EXTERNAL_STORYBOOK_SERVER_PROTOCOL)
    expect(record.pid).toBe(process.pid)
  })

  test("fails closed for foreign origins and unknown fields", () => {
    expect(() => createExternalStorybookServerRecord({
      toolRoot: import.meta.dir,
      origin: "https://example.com",
    })).toThrow("loopback HTTP origin")

    const root = temporaryRoot()
    const path = join(root, "server.json")
    writeFileSync(path, JSON.stringify({
      protocol: EXTERNAL_STORYBOOK_SERVER_PROTOCOL,
      extra: true,
    }))
    expect(() => readExternalStorybookServerRecord(path)).toThrow("unknown or missing fields")
  })

  test("reports missing state without adopting a foreign process", async () => {
    const inspection = await inspectExternalStorybookServer(join(temporaryRoot(), "missing.json"))
    expect(inspection).toEqual({state: "stopped", record: null, reason: null, replaceable: true})
  })

  test("admits only one concurrent server start owner", () => {
    const path = join(temporaryRoot(), "server.json")
    const first = acquireExternalStorybookStartLease(path)
    expect(() => acquireExternalStorybookStartLease(path)).toThrow("already in progress")
    first.release()
    const second = acquireExternalStorybookStartLease(path)
    second.release()
  })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "external-storybook-state-test-"))
  roots.push(root)
  return root
}
