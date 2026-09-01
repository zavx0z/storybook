import {afterEach, describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs"
import {readFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {acquireStorybookBrowserLock, withStorybookBrowserLock} from "./target-operation-lock.ts"

const roots: string[] = []
const worker = join(import.meta.dir, "fixtures", "browser-lock-worker.ts")

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})
})

describe("Storybook browser operation lock", () => {
  test("serializes separate MCP helper processes for one package", async () => {
    const root = temporaryRoot()
    const events = join(root, "events.log")
    const first = spawnWorker(root, events, "first", 250)
    await waitForEvent(events, "first:acquired")
    const second = spawnWorker(root, events, "second", 0)

    await Bun.sleep(80)
    expect(await eventLines(events)).toEqual(["first:acquired"])

    const [left, right] = await Promise.all([finish(first), finish(second)])
    expect(left).toEqual({exitCode: 0, stderr: ""})
    expect(right).toEqual({exitCode: 0, stderr: ""})
    expect(await eventLines(events)).toEqual([
      "first:acquired",
      "first:released",
      "second:acquired",
      "second:released",
    ])
  })

  test("releases after rejection and reclaims a dead persisted owner", async () => {
    const root = temporaryRoot()
    await expect(withStorybookBrowserLock({root, scope: "package:@fixture/a"}, async () => {
      throw new Error("expected rejection")
    })).rejects.toThrow("expected rejection")
    await (await acquireStorybookBrowserLock({root, scope: "package:@fixture/a", timeoutMs: 250})).release()

    const scope = "package:@fixture/stale"
    const digest = createHash("sha256").update(scope).digest("hex")
    const lockPath = join(root, `${digest}.lock`)
    mkdirSync(lockPath, {recursive: true})
    writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
      pid: 999_999,
      processStart: "dead",
      token: "stale",
      acquiredAt: "2000-01-01T00:00:00.000Z",
    }))
    await (await acquireStorybookBrowserLock({root, scope, timeoutMs: 250})).release()
  })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "storybook-browser-lock-"))
  roots.push(root)
  return root
}

function spawnWorker(
  root: string,
  events: string,
  label: string,
  holdMs: number,
): Bun.Subprocess<"ignore", "pipe", "pipe"> {
  return Bun.spawn([process.execPath, worker, root, "package:@fixture/a", events, label, String(holdMs)], {
    cwd: join(import.meta.dir, "../../.."),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
}

async function finish(child: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<{
  exitCode: number
  stderr: string
}> {
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  return {exitCode, stderr}
}

async function waitForEvent(path: string, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await eventLines(path)).includes(expected)) return
    await Bun.sleep(20)
  }
  throw new Error(`event did not arrive: ${expected}`)
}

async function eventLines(path: string): Promise<string[]> {
  try {
    return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}
