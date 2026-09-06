import {createHash, randomUUID} from "node:crypto"
import {mkdir, readFile, rename, rm, stat, writeFile} from "node:fs/promises"
import {join} from "node:path"
import type {StorybookProcessStart} from "./contract.ts"

type LockOwner = Readonly<{
  pid: number
  processStart: string
  token: string
  acquiredAt: string
}>

export async function withStorybookBrowserLock<Value>(
  input: Readonly<{
    root: string
    scope: string
    timeoutMs?: number
    signal?: AbortSignal
    processStart?: StorybookProcessStart
  }>,
  operation: () => Promise<Value>,
): Promise<Value> {
  const lock = await acquireStorybookBrowserLock(input)
  try {
    return await operation()
  } finally {
    await lock.release()
  }
}

export async function acquireStorybookBrowserLock(input: Readonly<{
  root: string
  scope: string
  timeoutMs?: number
  signal?: AbortSignal
  processStart?: StorybookProcessStart
}>): Promise<Readonly<{path: string; release(): Promise<void>}>> {
  if (input.scope.length === 0) throw new Error("Storybook browser lock scope is required")
  const timeoutMs = input.timeoutMs ?? 60_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new RangeError("Storybook browser lock timeout must be between 100 and 120000 ms")
  }
  const digest = createHash("sha256").update(input.scope).digest("hex")
  const path = join(input.root, `${digest}.lock`)
  const ownerPath = join(path, "owner.json")
  const readProcessStart = input.processStart ?? localProcessStart
  const processStart = readProcessStart(process.pid)
  if (processStart === null) throw new Error("Cannot identify Storybook browser lock process")
  const token = randomUUID()
  const deadline = Date.now() + timeoutMs
  await mkdir(input.root, {recursive: true, mode: 0o700})
  while (true) {
    input.signal?.throwIfAborted()
    try {
      await mkdir(path, {mode: 0o700})
      const owner = Object.freeze({pid: process.pid, processStart, token, acquiredAt: new Date().toISOString()})
      await writeFile(ownerPath, `${JSON.stringify(owner)}\n`, {encoding: "utf8", mode: 0o600})
      let released = false
      return Object.freeze({
        path,
        async release() {
          if (released) return
          released = true
          const current = await readOwner(ownerPath)
          if (current?.token !== token) throw new Error("Refusing to release a foreign Storybook browser lock")
          await rm(path, {recursive: true, force: true})
        },
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        await rm(path, {recursive: true, force: true}).catch(() => {})
        throw error
      }
    }
    if (await reclaimStale(path, ownerPath, token, readProcessStart)) continue
    if (Date.now() >= deadline) throw new DOMException("Storybook browser operation lock timed out", "TimeoutError")
    await abortableDelay(50, input.signal)
  }
}

function localProcessStart(pid: number): string | null {
  const result = Bun.spawnSync(["ps", "-p", String(pid), "-o", "lstart="])
  if (result.exitCode !== 0) return null
  const value = result.stdout.toString().trim()
  return value.length === 0 ? null : value
}

async function reclaimStale(
  path: string,
  ownerPath: string,
  token: string,
  readProcessStart: StorybookProcessStart,
): Promise<boolean> {
  const owner = await readOwner(ownerPath)
  if (owner !== null && readProcessStart(owner.pid) === owner.processStart) return false
  if (owner === null) {
    try {
      if (Date.now() - (await stat(path)).mtimeMs < 2_000) return false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true
      throw error
    }
  }
  const stale = `${path}.stale-${token}`
  try {
    await rename(path, stale)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true
    throw error
  }
  await rm(stale, {recursive: true, force: true})
  return true
}

async function readOwner(path: string): Promise<LockOwner | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<LockOwner>
    return Number.isSafeInteger(value.pid) && typeof value.processStart === "string" &&
      typeof value.token === "string" && typeof value.acquiredAt === "string"
      ? value as LockOwner
      : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null
    throw error
  }
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) {
    await Bun.sleep(ms)
    return
  }
  if (signal.aborted) throw signal.reason
  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolvePromise()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener("abort", onAbort, {once: true})
  })
}
