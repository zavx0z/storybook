import {afterAll, describe, expect, test} from "bun:test"
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import {
  acquireTargetOperationLock,
  targetOperationLockPath,
  withTargetOperationLock,
} from "./target-operation-lock.ts"

const checkout = resolve(import.meta.dir, "../..")
const worker = join(import.meta.dir, "fixtures/target-lock-worker.ts")
const creationWorker = join(import.meta.dir, "fixtures/target-creation-lock-worker.ts")
const temporaryRoots: string[] = []

afterAll(async () => {
  await Promise.all(temporaryRoots.map((path) => rm(path, {recursive: true, force: true})))
})

describe("Storybook target operation lock", () => {
  test("serializes separate browser-helper processes for one exact target", async () => {
    const root = await temporaryRoot()
    const events = join(root, "events.log")
    const first = spawnWorker(root, events, "first", 250)
    await waitForEvent(events, "first:acquired")
    const second = spawnWorker(root, events, "second", 0)

    await Bun.sleep(80)
    expect(await eventLines(events)).toEqual(["first:acquired"])

    const [firstResult, secondResult] = await Promise.all([finish(first), finish(second)])
    expect(firstResult).toMatchObject({exitCode: 0, stderr: ""})
    expect(secondResult).toMatchObject({exitCode: 0, stderr: ""})
    expect(await eventLines(events)).toEqual([
      "first:acquired",
      "first:released",
      "second:acquired",
      "second:released",
    ])
  })

  test("releases the exact target after a rejected operation", async () => {
    const root = await temporaryRoot()
    await expect(withTargetOperationLock({
      stateRoot: root,
      targetId: "TARGET-REJECTION",
      cdpPort: 19_222,
    }, async () => {
      throw new Error("expected rejection")
    })).rejects.toThrow("expected rejection")

    const next = await acquireTargetOperationLock({
      stateRoot: root,
      targetId: "TARGET-REJECTION",
      cdpPort: 19_222,
      timeoutMs: 250,
    })
    await next.release()
  })

  test("reclaims a lock left by a terminated helper process", async () => {
    const root = await temporaryRoot()
    const events = join(root, "terminated-events.log")
    const terminated = spawnWorker(root, events, "terminated", 30_000)
    await waitForEvent(events, "terminated:acquired")
    terminated.kill("SIGKILL")
    await terminated.exited

    const recovered = spawnWorker(root, events, "recovered", 0)
    expect(await finish(recovered)).toMatchObject({exitCode: 0, stderr: ""})
    expect(await eventLines(events)).toEqual([
      "terminated:acquired",
      "recovered:acquired",
      "recovered:released",
    ])
  })

  test("reclaims a persisted owner whose pid no longer exists", async () => {
    const root = await temporaryRoot()
    const options = {stateRoot: root, targetId: "STALE-TARGET", cdpPort: 19_222}
    const path = targetOperationLockPath(options)
    await mkdir(path, {recursive: true})
    await writeFile(join(path, "owner.json"), JSON.stringify({
      pid: 999_999,
      token: "stale",
      acquiredAt: "2000-01-01T00:00:00.000Z",
    }))

    const lock = await acquireTargetOperationLock({...options, timeoutMs: 250})
    await lock.release()
  })

  test("serializes target discovery and creation across open processes", async () => {
    const root = await temporaryRoot()
    const targetState = join(root, "target.txt")
    const events = join(root, "creation-events.log")
    const first = spawnCreationWorker(root, targetState, events, "first", 250)
    await waitForEvent(events, "first:creating")
    const second = spawnCreationWorker(root, targetState, events, "second", 0)
    await waitForEvent(events, "second:attempt")

    await Bun.sleep(80)
    expect(await eventLines(events)).not.toContain("second:acquired")

    const [firstResult, secondResult] = await Promise.all([finish(first), finish(second)])
    expect(firstResult).toMatchObject({exitCode: 0, stderr: ""})
    expect(secondResult).toMatchObject({exitCode: 0, stderr: ""})
    expect(await readFile(targetState, "utf8")).toBe("TARGET-1\n")
    expect(await eventLines(events)).toEqual([
      "first:attempt",
      "first:acquired",
      "first:creating",
      "second:attempt",
      "first:created",
      "first:released",
      "second:acquired",
      "second:reused",
      "second:released",
    ])
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "storybook-target-lock-"))
  temporaryRoots.push(root)
  return root
}

function spawnWorker(root: string, events: string, label: string, holdMs: number): Bun.Subprocess<"ignore", "pipe", "pipe"> {
  return Bun.spawn([
    process.execPath,
    worker,
    root,
    "SAME-TARGET",
    events,
    label,
    String(holdMs),
  ], {
    cwd: checkout,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
}

function spawnCreationWorker(
  root: string,
  targetState: string,
  events: string,
  label: string,
  holdMs: number,
): Bun.Subprocess<"ignore", "pipe", "pipe"> {
  return Bun.spawn([
    process.execPath,
    creationWorker,
    root,
    "http://storybook.test",
    targetState,
    events,
    label,
    String(holdMs),
  ], {
    cwd: checkout,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
}

async function finish(child: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<{exitCode: number; stderr: string}> {
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ])
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
