import {randomUUID} from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import {dirname, isAbsolute, join, resolve} from "node:path"
import {tmpdir} from "node:os"

export const EXTERNAL_STORYBOOK_SERVER_PROTOCOL = "external-storybook-server/1" as const

export type ExternalStorybookServerRecord = Readonly<{
  protocol: typeof EXTERNAL_STORYBOOK_SERVER_PROTOCOL
  toolRoot: string
  pid: number
  processStart: string
  origin: string
  healthPath: "/api/health"
  websocketPath: "/api/events"
  attachedDeclarations: readonly string[]
  startedAt: string
}>

export type ExternalStorybookServerInspection = Readonly<{
  state: "stopped" | "running" | "stale"
  record: ExternalStorybookServerRecord | null
  reason: string | null
  replaceable: boolean
}>

export type ExternalStorybookStartLease = Readonly<{
  path: string
  release(): void
}>

export function externalStorybookStateRoot(): string {
  const configured = Bun.env.STORYBOOK_STATE_ROOT
  return resolve(configured === undefined || configured.trim().length === 0
    ? join(tmpdir(), "zavx0z-external-storybook")
    : configured)
}

export function externalStorybookServerStatePath(): string {
  return join(externalStorybookStateRoot(), "server.json")
}

export function externalStorybookArtifactRoot(): string {
  return join(externalStorybookStateRoot(), "artifacts")
}

export function acquireExternalStorybookStartLease(
  statePath = externalStorybookServerStatePath(),
): ExternalStorybookStartLease {
  const path = `${resolve(statePath)}.start.lock`
  mkdirSync(dirname(path), {recursive: true})
  const processStart = readProcessStart(process.pid)
  if (processStart === null) throw new Error("Cannot identify Storybook start-lock process")
  const token = randomUUID()
  const owner = {pid: process.pid, processStart, token}
  const acquire = (): void => {
    try {
      writeFileSync(path, `${JSON.stringify(owner)}\n`, {flag: "wx"})
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const current = readStartLeaseOwner(path)
      if (current !== null && (!processExists(current.pid) ||
        readProcessStart(current.pid) !== current.processStart)) {
        unlinkSync(path)
        writeFileSync(path, `${JSON.stringify(owner)}\n`, {flag: "wx"})
        return
      }
      throw new Error("External Storybook server start is already in progress")
    }
  }
  acquire()
  let released = false
  return Object.freeze({
    path,
    release() {
      if (released) return
      released = true
      const current = readStartLeaseOwner(path)
      if (current?.token === token && current.pid === process.pid &&
        current.processStart === processStart) unlinkSync(path)
    },
  })
}

export function createExternalStorybookServerRecord(input: Readonly<{
  toolRoot: string
  origin: string
  attachedDeclarations?: readonly string[]
}>): ExternalStorybookServerRecord {
  const toolRoot = realpathSync(input.toolRoot)
  const origin = loopbackOrigin(input.origin)
  const processStart = readProcessStart(process.pid)
  if (processStart === null) throw new Error("Cannot determine external Storybook process start identity")
  return Object.freeze({
    protocol: EXTERNAL_STORYBOOK_SERVER_PROTOCOL,
    toolRoot,
    pid: process.pid,
    processStart,
    origin,
    healthPath: "/api/health",
    websocketPath: "/api/events",
    attachedDeclarations: Object.freeze(
      [...(input.attachedDeclarations ?? [])].map((path) => realpathSync(path)).sort(),
    ),
    startedAt: new Date().toISOString(),
  })
}

export function writeExternalStorybookServerRecord(
  path: string,
  record: ExternalStorybookServerRecord,
): void {
  if (!isAbsolute(path)) throw new Error(`External Storybook state path must be absolute: ${path}`)
  validateExternalStorybookServerRecord(record)
  mkdirSync(dirname(path), {recursive: true})
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, {flag: "wx"})
  renameSync(temporary, path)
}

export function readExternalStorybookServerRecord(path: string): ExternalStorybookServerRecord {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Error(`Cannot read external Storybook state: ${path}`, {cause: error})
  }
  return validateExternalStorybookServerRecord(value)
}

export async function inspectExternalStorybookServer(
  statePath = externalStorybookServerStatePath(),
): Promise<ExternalStorybookServerInspection> {
  if (!existsSync(statePath)) return inspection("stopped", null, null, true)
  let record: ExternalStorybookServerRecord
  try {
    record = readExternalStorybookServerRecord(statePath)
  } catch (error) {
    return inspection("stale", null, errorText(error), false)
  }
  if (!processExists(record.pid)) {
    return inspection("stale", record, "recorded process does not exist", true)
  }
  if (readProcessStart(record.pid) !== record.processStart) {
    return inspection("stale", record, "recorded PID was reused", false)
  }
  if (readProcessDirectory(record.pid) !== record.toolRoot) {
    return inspection("stale", record, "recorded process cwd does not match tool root", false)
  }
  try {
    const response = await fetch(new URL(record.healthPath, record.origin), {
      redirect: "manual",
      signal: AbortSignal.timeout(1_500),
    })
    if (response.status !== 200) {
      return inspection("stale", record, `health returned ${response.status}`, false)
    }
    return inspection("running", record, null, false)
  } catch (error) {
    return inspection("stale", record, `health request failed: ${errorText(error)}`, false)
  }
}

export function removeReplaceableExternalStorybookState(
  inspectionValue: ExternalStorybookServerInspection,
  statePath = externalStorybookServerStatePath(),
): void {
  if (inspectionValue.state !== "stale" || !inspectionValue.replaceable) {
    throw new Error("Refusing to remove non-replaceable external Storybook state")
  }
  try {
    unlinkSync(statePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

export function readProcessStart(pid: number): string | null {
  const result = Bun.spawnSync(["ps", "-p", String(pid), "-o", "lstart="])
  if (result.exitCode !== 0) return null
  const value = result.stdout.toString().trim()
  return value.length === 0 ? null : value
}

export function readProcessDirectory(pid: number): string | null {
  const result = Bun.spawnSync(["lsof", "-a", "-p", String(pid), "-d", "cwd", "-Fn"])
  if (result.exitCode !== 0) return null
  const path = result.stdout.toString().split(/\r?\n/u)
    .find((line) => line.startsWith("n"))?.slice(1)
  if (path === undefined || path.length === 0) return null
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function validateExternalStorybookServerRecord(value: unknown): ExternalStorybookServerRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("External Storybook state must be an object")
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expected = [
    "attachedDeclarations",
    "healthPath",
    "origin",
    "pid",
    "processStart",
    "protocol",
    "startedAt",
    "toolRoot",
    "websocketPath",
  ].sort()
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error(`External Storybook state has unknown or missing fields: ${keys.join(", ")}`)
  }
  if (record.protocol !== EXTERNAL_STORYBOOK_SERVER_PROTOCOL) {
    throw new Error(`Unsupported external Storybook state protocol: ${String(record.protocol)}`)
  }
  const toolRoot = requiredAbsolutePath("toolRoot", record.toolRoot)
  const pid = Number(record.pid)
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid external Storybook PID: ${String(record.pid)}`)
  const processStart = requiredText("processStart", record.processStart)
  const origin = loopbackOrigin(requiredText("origin", record.origin))
  if (record.healthPath !== "/api/health") throw new Error("Invalid external Storybook health path")
  if (record.websocketPath !== "/api/events") throw new Error("Invalid external Storybook WebSocket path")
  if (!Array.isArray(record.attachedDeclarations)) {
    throw new Error("External Storybook attachedDeclarations must be an array")
  }
  const attachedDeclarations = record.attachedDeclarations.map((path, index) =>
    requiredAbsolutePath(`attachedDeclarations[${index}]`, path))
  if (new Set(attachedDeclarations).size !== attachedDeclarations.length) {
    throw new Error("External Storybook attachedDeclarations contain duplicates")
  }
  const startedAt = requiredText("startedAt", record.startedAt)
  if (!Number.isFinite(Date.parse(startedAt))) throw new Error(`Invalid external Storybook startedAt: ${startedAt}`)
  return Object.freeze({
    protocol: EXTERNAL_STORYBOOK_SERVER_PROTOCOL,
    toolRoot,
    pid,
    processStart,
    origin,
    healthPath: "/api/health",
    websocketPath: "/api/events",
    attachedDeclarations: Object.freeze(attachedDeclarations),
    startedAt,
  })
}

function readStartLeaseOwner(path: string): Readonly<{
  pid: number
  processStart: string
  token: string
}> | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown
    if (value === null || typeof value !== "object") return null
    const record = value as Record<string, unknown>
    const pid = Number(record.pid)
    const processStart = record.processStart
    const token = record.token
    if (!Number.isSafeInteger(pid) || pid <= 0 || typeof processStart !== "string" ||
      processStart.length === 0 || typeof token !== "string" || token.length === 0) return null
    return Object.freeze({pid, processStart, token})
  } catch {
    return null
  }
}

function loopbackOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`External Storybook origin must be loopback HTTP origin: ${value}`)
  }
  return url.origin
}

function requiredAbsolutePath(label: string, value: unknown): string {
  const path = requiredText(label, value)
  if (!isAbsolute(path)) throw new Error(`External Storybook ${label} must be absolute: ${path}`)
  return path
}

function requiredText(label: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`External Storybook ${label} must be non-empty text`)
  }
  return value
}

function inspection(
  state: ExternalStorybookServerInspection["state"],
  record: ExternalStorybookServerRecord | null,
  reason: string | null,
  replaceable: boolean,
): ExternalStorybookServerInspection {
  return Object.freeze({state, record, reason, replaceable})
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
