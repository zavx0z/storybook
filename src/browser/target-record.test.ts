import {afterEach, describe, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {
  clearStorybookBrowserTargetRecord,
  readStorybookBrowserTargetRecord,
  writeStorybookBrowserTargetRecord,
  type StorybookBrowserTargetOwner,
} from "./target-record.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, {recursive: true, force: true})))
})

describe("package-owned Storybook browser target record", () => {
  test("persists one exact target across automatic-port runtime restarts", async () => {
    const owner = await targetOwner()
    expect(readStorybookBrowserTargetRecord(owner)).toBeNull()
    const written = writeStorybookBrowserTargetRecord(owner, "TARGET-1")
    expect(written.targetId).toBe("TARGET-1")
    expect(readStorybookBrowserTargetRecord(owner)?.targetId).toBe("TARGET-1")
    expect(clearStorybookBrowserTargetRecord(owner, "OTHER")).toBeFalse()
    expect(clearStorybookBrowserTargetRecord(owner, "TARGET-1")).toBeTrue()
    expect(readStorybookBrowserTargetRecord(owner)).toBeNull()
  })

  test("fails closed when another package or CDP browser owns the record", async () => {
    const owner = await targetOwner()
    writeStorybookBrowserTargetRecord(owner, "TARGET-1")
    expect(() => readStorybookBrowserTargetRecord({...owner, packageName: "@other/storybook"}))
      .toThrow("identity does not match")
    expect(() => readStorybookBrowserTargetRecord({...owner, cdpPort: 9333}))
      .toThrow("identity does not match")
  })
})

async function targetOwner(): Promise<StorybookBrowserTargetOwner> {
  const root = await mkdtemp(join(tmpdir(), "storybook-target-record-"))
  roots.push(root)
  return {
    statePath: join(root, "runtime.json"),
    packageName: "@ui/storybook",
    packageDirectory: "/repo/ui/packages/storybook",
    cdpPort: 9222,
  }
}
