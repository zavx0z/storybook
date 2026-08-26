import {createHash} from "node:crypto"
import {mkdir, readFile, rename, rm, stat, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"

type LockOwner = Readonly<{
  pid: number
  token: string
  acquiredAt: string
}>

export type TargetOperationLockOptions = Readonly<{
  targetId: string
  cdpPort: number
  stateRoot?: string | undefined
  timeoutMs?: number | undefined
  retryMs?: number | undefined
}>

export type TargetOperationLock = Readonly<{
  path: string
  release(): Promise<void>
}>

export type TargetCreationLockOptions = Readonly<{
  creationScope: string
  cdpPort: number
  stateRoot?: string | undefined
  timeoutMs?: number | undefined
  retryMs?: number | undefined
}>

const orphanGraceMs = 2_000

/** Serializes target discovery and creation for one Storybook origin or exact URL. */
export async function withTargetCreationLock<T>(
  options: TargetCreationLockOptions,
  operation: () => Promise<T>,
): Promise<T> {
  if (options.creationScope.length === 0) throw new Error("target creation lock requires an origin or exact URL")
  const targetId = `creation-${createHash("sha256").update(options.creationScope).digest("hex")}`
  return withTargetOperationLock({
    targetId,
    cdpPort: options.cdpPort,
    ...(options.stateRoot === undefined ? {} : {stateRoot: options.stateRoot}),
    ...(options.timeoutMs === undefined ? {} : {timeoutMs: options.timeoutMs}),
    ...(options.retryMs === undefined ? {} : {retryMs: options.retryMs}),
  }, operation)
}

/**
 * Runs one browser operation at a time for an exact CDP target, including
 * operations started by separate `$storybook` browser processes.
 */
export async function withTargetOperationLock<T>(
  options: TargetOperationLockOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = await acquireTargetOperationLock(options)
  try {
    return await operation()
  } finally {
    await lock.release()
  }
}

export async function acquireTargetOperationLock(
  options: TargetOperationLockOptions,
): Promise<TargetOperationLock> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const retryMs = options.retryMs ?? 50
  if (!Number.isInteger(options.cdpPort) || options.cdpPort < 1 || options.cdpPort > 65_535) {
    throw new Error("target operation lock requires cdpPort 1..65535")
  }
  if (options.targetId.length === 0) throw new Error("target operation lock requires targetId")
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error("target operation lock requires a positive timeoutMs")
  if (!Number.isFinite(retryMs) || retryMs < 1) throw new Error("target operation lock requires a positive retryMs")

  const path = targetOperationLockPath(options)
  const ownerPath = join(path, "owner.json")
  const token = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`
  const deadline = Date.now() + timeoutMs
  await mkdir(dirname(path), {recursive: true})

  while (true) {
    try {
      await mkdir(path)
      const owner: LockOwner = {
        pid: process.pid,
        token,
        acquiredAt: new Date().toISOString(),
      }
      await writeFile(ownerPath, `${JSON.stringify(owner)}\n`, "utf8")
      let released = false
      return Object.freeze({
        path,
        async release() {
          if (released) return
          released = true
          const current = await readOwner(ownerPath)
          if (current?.token !== token) {
            throw new Error(`refusing to release a target operation lock owned by another process: ${path}`)
          }
          await rm(path, {recursive: true, force: true})
        },
      })
    } catch (error) {
      if (!isAlreadyExists(error)) {
        await rm(path, {recursive: true, force: true}).catch(() => undefined)
        throw error
      }
    }

    if (await reclaimOrphanedLock(path, ownerPath, token)) continue
    if (Date.now() >= deadline) {
      const owner = await readOwner(ownerPath)
      throw new Error(`target operation lock timeout for ${options.targetId} on CDP ${options.cdpPort}; owner pid ${owner?.pid ?? "unknown"}`)
    }
    await Bun.sleep(retryMs)
  }
}

export function targetOperationLockPath(options: Pick<TargetOperationLockOptions, "targetId" | "cdpPort" | "stateRoot">): string {
  const stateRoot = options.stateRoot ?? process.env.STORYBOOK_STATE_ROOT ?? join(tmpdir(), "zavx0z-storybook")
  const safeTargetId = options.targetId.replace(/[^a-zA-Z0-9._-]/g, "_")
  return join(stateRoot, "browser-target-locks", `cdp-${options.cdpPort}-${safeTargetId}.lock`)
}

async function reclaimOrphanedLock(path: string, ownerPath: string, token: string): Promise<boolean> {
  const owner = await readOwner(ownerPath)
  if (owner !== null && processIsAlive(owner.pid)) return false
  if (owner === null) {
    try {
      const details = await stat(path)
      if (Date.now() - details.mtimeMs < orphanGraceMs) return false
    } catch (error) {
      if (isMissing(error)) return true
      throw error
    }
  }

  const stalePath = `${path}.stale-${token}`
  try {
    await rename(path, stalePath)
  } catch (error) {
    if (isMissing(error)) return true
    throw error
  }
  await rm(stalePath, {recursive: true, force: true})
  return true
}

async function readOwner(path: string): Promise<LockOwner | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<LockOwner>
    return Number.isInteger(value.pid)
      && typeof value.token === "string"
      && typeof value.acquiredAt === "string"
      ? value as LockOwner
      : null
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return null
    throw error
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST"
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT"
}
