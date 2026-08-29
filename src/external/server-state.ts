import {createHash, randomBytes, randomUUID} from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import {dirname, isAbsolute, join, resolve} from "node:path"
import {homedir, tmpdir} from "node:os"

export const EXTERNAL_STORYBOOK_SERVER_PROTOCOL = "external-storybook-server/1" as const
const EXTERNAL_STORYBOOK_MIGRATION_PROTOCOL = "external-storybook-migration/1" as const

export type ExternalStorybookServerRecord = Readonly<{
  protocol: typeof EXTERNAL_STORYBOOK_SERVER_PROTOCOL
  instanceId: string
  controlToken: string
  /** Absent only while adopting and replacing a pre-handshake daemon record. */
  implementationDigest?: string
  toolRoot: string
  pid: number
  processStart: string
  origin: string
  healthPath: "/api/health"
  websocketPath: "/api/events"
  attachedDeclarations: readonly string[]
  startedAt: string
}>

/** Serializable server identity that deliberately excludes control authority. */
export type ExternalStorybookPublicServerRecord = Omit<ExternalStorybookServerRecord, "controlToken">

export type ExternalStorybookServerInspection = Readonly<{
  state: "stopped" | "running" | "stale"
  record: ExternalStorybookServerRecord | null
  reason: string | null
  replaceable: boolean
}>

export type ExternalStorybookStartLease = Readonly<{
  path: string
  token: string
  release(): void
}>

export type ExternalStorybookMigrationRecord = Readonly<{
  protocol: typeof EXTERNAL_STORYBOOK_MIGRATION_PROTOCOL
  toolRoot: string
  declarations: readonly string[]
  preferredPort?: number
  recordedAt: string
}>

export function externalStorybookStateRoot(): string {
  const configured = Bun.env.STORYBOOK_STATE_ROOT
  return resolve(configured === undefined || configured.trim().length === 0
    ? join(homedir(), "Library", "Caches", "zavx0z-external-storybook")
    : configured)
}

export function externalStorybookServerStatePath(): string {
  return join(externalStorybookStateRoot(), "server.json")
}

export function externalStorybookArtifactRoot(): string {
  return join(externalStorybookStateRoot(), "artifacts")
}

export function externalStorybookMigrationStatePath(): string {
  return join(externalStorybookStateRoot(), "migration.json")
}

export function readExternalStorybookMigrationRecord(
  path = externalStorybookMigrationStatePath(),
): ExternalStorybookMigrationRecord | null {
  if (!existsSync(path)) return null
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Error(`Cannot read external Storybook migration state: ${path}`, {cause: error})
  }
  return validateMigrationRecord(value)
}

export function writeExternalStorybookMigrationRecord(
  input: Readonly<{toolRoot: string; declarations: readonly string[]; preferredPort?: number}>,
  path = externalStorybookMigrationStatePath(),
): ExternalStorybookMigrationRecord {
  const record = validateMigrationRecord({
    protocol: EXTERNAL_STORYBOOK_MIGRATION_PROTOCOL,
    toolRoot: realpathSync(input.toolRoot),
    declarations: [...new Set(input.declarations)].sort(),
    ...(input.preferredPort === undefined ? {} : {preferredPort: input.preferredPort}),
    recordedAt: new Date().toISOString(),
  })
  ensurePrivateStateDirectory(dirname(path))
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writePrivateFile(temporary, `${JSON.stringify(record, null, 2)}\n`)
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } finally {
    try {
      unlinkSync(temporary)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  return record
}

export function clearExternalStorybookMigrationRecord(
  toolRoot: string,
  path = externalStorybookMigrationStatePath(),
): boolean {
  const current = readExternalStorybookMigrationRecord(path)
  if (current === null) return false
  if (current.toolRoot !== toolRoot) throw new Error("Refusing to clear a foreign Storybook migration record")
  unlinkSync(path)
  return true
}

export function externalStorybookLegacyStatePaths(): readonly string[] {
  if (Bun.env.STORYBOOK_STATE_ROOT?.trim()) return Object.freeze([])
  const roots = [tmpdir(), "/tmp", darwinUserTempDirectory()]
    .filter((value): value is string => value !== null)
    .map((root) => resolve(root, "zavx0z-external-storybook", "server.json"))
    .filter((path) => path !== externalStorybookServerStatePath())
  return Object.freeze([...new Set(roots)])
}

export function acquireExternalStorybookStartLease(
  statePath = externalStorybookServerStatePath(),
): ExternalStorybookStartLease {
  const path = `${resolve(statePath)}.start.lock`
  const ownerPath = join(path, "owner.json")
  ensurePrivateStateDirectory(dirname(path))
  const processStart = readProcessStart(process.pid)
  if (processStart === null) throw new Error("Cannot identify Storybook start-lock process")
  const token = randomUUID()
  const owner = {pid: process.pid, processStart, token}
  while (true) {
    try {
      mkdirSync(path, {mode: 0o700})
      try {
        writePrivateFile(ownerPath, `${JSON.stringify(owner)}\n`)
      } catch (error) {
        rmSync(path, {recursive: true, force: true})
        throw error
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const current = readStartLeaseOwner(ownerPath)
      if (current !== null && processExists(current.pid) &&
        readProcessStart(current.pid) === current.processStart) {
        throw new Error("External Storybook server start is already in progress")
      }
      if (current === null) {
        try {
          if (Date.now() - statSync(path).mtimeMs < 2_000) {
            throw new Error("External Storybook server start is already in progress")
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
          throw error
        }
      }
      const stale = `${path}.stale-${token}-${randomUUID()}`
      try {
        renameSync(path, stale)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
        throw error
      }
      rmSync(stale, {recursive: true, force: true})
    }
  }
  let released = false
  return Object.freeze({
    path,
    token,
    release() {
      if (released) return
      released = true
      const current = readStartLeaseOwner(ownerPath)
      if (current?.token === token && current.pid === process.pid &&
        current.processStart === processStart) rmSync(path, {recursive: true, force: true})
    },
  })
}

export function assertExternalStorybookStartLease(path: string, token: string): void {
  const owner = readStartLeaseOwner(join(resolve(path), "owner.json"))
  if (owner?.token !== token) throw new Error("External Storybook startup lease was superseded")
}

export function writeExternalStorybookStartCandidate(
  lease: Readonly<{path: string; token: string}>,
  record: ExternalStorybookServerRecord,
): void {
  assertExternalStorybookStartLease(lease.path, lease.token)
  const validated = validateExternalStorybookServerRecord(record)
  if (validated.implementationDigest === undefined) {
    throw new Error("Storybook startup candidate requires an implementation digest")
  }
  const path = startCandidatePath(lease.path, lease.token)
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writePrivateFile(temporary, `${JSON.stringify(validated, null, 2)}\n`)
    renameSync(temporary, path)
    chmodSync(path, 0o600)
    assertExternalStorybookStartLease(lease.path, lease.token)
  } catch (error) {
    try {
      unlinkSync(path)
    } catch (unlinkError) {
      if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError
    }
    throw error
  } finally {
    try {
      unlinkSync(temporary)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
}

export function publishExternalStorybookStartCandidate(input: Readonly<{
  lease: Readonly<{path: string; token: string}>
  statePath: string
  toolRoot: string
  childPid: number
}>): ExternalStorybookServerRecord | null {
  assertExternalStorybookStartLease(input.lease.path, input.lease.token)
  const candidatePath = startCandidatePath(input.lease.path, input.lease.token)
  if (!existsSync(candidatePath)) return null
  const candidate = readExternalStorybookServerRecord(candidatePath)
  if (candidate.toolRoot !== input.toolRoot || candidate.pid !== input.childPid ||
    candidate.implementationDigest === undefined) {
    throw new Error("Storybook startup candidate identity mismatch")
  }
  // The live controller owns the lease throughout this synchronous atomic
  // replacement, so no stale reclaimer can change the generation mid-commit.
  assertExternalStorybookStartLease(input.lease.path, input.lease.token)
  writeExternalStorybookServerRecord(input.statePath, candidate)
  unlinkSync(candidatePath)
  return candidate
}

export function createExternalStorybookServerRecord(input: Readonly<{
  toolRoot: string
  origin: string
  implementationDigest: string
  attachedDeclarations?: readonly string[]
}>): ExternalStorybookServerRecord {
  const toolRoot = realpathSync(input.toolRoot)
  const origin = loopbackOrigin(input.origin)
  const implementationDigest = requiredImplementationDigest(input.implementationDigest)
  const processStart = readProcessStart(process.pid)
  if (processStart === null) throw new Error("Cannot determine external Storybook process start identity")
  return Object.freeze({
    protocol: EXTERNAL_STORYBOOK_SERVER_PROTOCOL,
    instanceId: randomUUID(),
    controlToken: randomBytes(32).toString("base64url"),
    implementationDigest,
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
  const validated = validateExternalStorybookServerRecord(record)
  if (validated.implementationDigest === undefined) {
    throw new Error("Refusing to publish a legacy external Storybook state without implementation digest")
  }
  ensurePrivateStateDirectory(dirname(path))
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writePrivateFile(temporary, `${JSON.stringify(validated, null, 2)}\n`)
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } finally {
    try {
      unlinkSync(temporary)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
}

/** Removes the bearer capability before a state record crosses a public boundary. */
export function projectExternalStorybookServerRecord(
  value: ExternalStorybookServerRecord,
): ExternalStorybookPublicServerRecord {
  const record = validateExternalStorybookServerRecord(value)
  return Object.freeze({
    protocol: record.protocol,
    instanceId: record.instanceId,
    ...(record.implementationDigest === undefined
      ? {}
      : {implementationDigest: record.implementationDigest}),
    toolRoot: record.toolRoot,
    pid: record.pid,
    processStart: record.processStart,
    origin: record.origin,
    healthPath: record.healthPath,
    websocketPath: record.websocketPath,
    attachedDeclarations: record.attachedDeclarations,
    startedAt: record.startedAt,
  })
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
    "controlToken",
    "healthPath",
    "instanceId",
    "implementationDigest",
    "origin",
    "pid",
    "processStart",
    "protocol",
    "startedAt",
    "toolRoot",
    "websocketPath",
  ].sort()
  const legacyExpected = expected.filter((key) => key !== "implementationDigest")
  const preCapabilityExpected = expected.filter((key) =>
    !["controlToken", "implementationDigest", "instanceId"].includes(key))
  const currentShape = JSON.stringify(keys) === JSON.stringify(expected)
  const legacyShape = JSON.stringify(keys) === JSON.stringify(legacyExpected)
  const preCapabilityShape = JSON.stringify(keys) === JSON.stringify(preCapabilityExpected)
  if (!currentShape && !legacyShape && !preCapabilityShape) {
    throw new Error(`External Storybook state has unknown or missing fields: ${keys.join(", ")}`)
  }
  if (record.protocol !== EXTERNAL_STORYBOOK_SERVER_PROTOCOL) {
    throw new Error(`Unsupported external Storybook state protocol: ${String(record.protocol)}`)
  }
  const legacyIdentitySource = `${String(record.pid)}\0${String(record.processStart)}\0${String(record.origin)}`
  const instanceId = preCapabilityShape
    ? deterministicLegacyInstanceId(legacyIdentitySource)
    : requiredText("instanceId", record.instanceId)
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(instanceId)) {
    throw new Error(`Invalid external Storybook instanceId: ${instanceId}`)
  }
  const controlToken = preCapabilityShape
    ? createHash("sha256").update(`external-storybook-legacy-control\0${legacyIdentitySource}`).digest("base64url")
    : requiredText("controlToken", record.controlToken)
  if (!/^[A-Za-z0-9_-]{43}$/u.test(controlToken)) {
    throw new Error("Invalid external Storybook control token")
  }
  const implementationDigest = currentShape
    ? requiredImplementationDigest(record.implementationDigest)
    : undefined
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
    instanceId,
    controlToken,
    ...(implementationDigest === undefined ? {} : {implementationDigest}),
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

function validateMigrationRecord(value: unknown): ExternalStorybookMigrationRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("External Storybook migration state must be an object")
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expected = ["declarations", "preferredPort", "protocol", "recordedAt", "toolRoot"]
  const withoutPort = expected.filter((key) => key !== "preferredPort")
  if (JSON.stringify(keys) !== JSON.stringify(expected.sort()) &&
    JSON.stringify(keys) !== JSON.stringify(withoutPort.sort())) {
    throw new Error(`External Storybook migration state has unknown or missing fields: ${keys.join(", ")}`)
  }
  if (record.protocol !== EXTERNAL_STORYBOOK_MIGRATION_PROTOCOL) {
    throw new Error(`Unsupported external Storybook migration protocol: ${String(record.protocol)}`)
  }
  const toolRoot = requiredAbsolutePath("migration toolRoot", record.toolRoot)
  if (!Array.isArray(record.declarations)) throw new Error("Storybook migration declarations must be an array")
  const declarations = record.declarations.map((path, index) =>
    requiredAbsolutePath(`migration declarations[${index}]`, path))
  if (new Set(declarations).size !== declarations.length ||
    JSON.stringify([...declarations].sort()) !== JSON.stringify(declarations)) {
    throw new Error("Storybook migration declarations must be unique and sorted")
  }
  let preferredPort: number | undefined
  if (record.preferredPort !== undefined) {
    preferredPort = Number(record.preferredPort)
    if (!Number.isSafeInteger(preferredPort) || preferredPort < 1 || preferredPort > 65_535) {
      throw new Error("Invalid Storybook migration preferred port")
    }
  }
  const recordedAt = requiredText("migration recordedAt", record.recordedAt)
  if (!Number.isFinite(Date.parse(recordedAt))) throw new Error("Invalid Storybook migration timestamp")
  return Object.freeze({
    protocol: EXTERNAL_STORYBOOK_MIGRATION_PROTOCOL,
    toolRoot,
    declarations: Object.freeze(declarations),
    ...(preferredPort === undefined ? {} : {preferredPort}),
    recordedAt,
  })
}

function requiredImplementationDigest(value: unknown): string {
  const digest = requiredText("implementationDigest", value)
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new Error("Invalid external Storybook implementation digest")
  }
  return digest
}

function startCandidatePath(leasePath: string, token: string): string {
  if (!/^[a-f0-9-]{36}$/u.test(token)) throw new Error("Invalid Storybook startup lease token")
  return join(resolve(leasePath), `candidate-${token}.json`)
}

function deterministicLegacyInstanceId(value: string): string {
  const digest = createHash("sha256").update(`external-storybook-legacy-instance\0${value}`).digest("hex")
  const hex = `${digest.slice(0, 12)}4${digest.slice(13, 16)}8${digest.slice(17, 32)}`
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function darwinUserTempDirectory(): string | null {
  if (process.platform !== "darwin") return null
  const result = Bun.spawnSync(["getconf", "DARWIN_USER_TEMP_DIR"])
  if (result.exitCode !== 0) return null
  const value = result.stdout.toString().trim()
  return value.length > 0 && isAbsolute(value) ? value : null
}

function ensurePrivateStateDirectory(path: string): void {
  mkdirSync(path, {recursive: true, mode: 0o700})
  chmodSync(path, 0o700)
}

function writePrivateFile(path: string, value: string): void {
  writeFileSync(path, value, {flag: "wx", mode: 0o600})
  chmodSync(path, 0o600)
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
