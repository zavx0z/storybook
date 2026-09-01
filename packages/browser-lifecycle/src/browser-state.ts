import {createHash, randomBytes, randomUUID} from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import {join, resolve} from "node:path"

const TARGET_RECORD_PROTOCOL = "external-storybook-browser-target/3" as const
const LEGACY_TARGET_RECORD_PROTOCOLS = new Set([
  "external-storybook-browser-target/1",
  "external-storybook-browser-target/2",
])

type StorybookBrowserTargetRecordBase = Readonly<{
  protocol: typeof TARGET_RECORD_PROTOCOL
  packageId: string
  cdpOrigin: string
  browserIdentity: string | null
  url: string | null
  baselineTargetIds: readonly string[]
  recordedAt: string
}>

export type StorybookBrowserTargetRecord = StorybookBrowserTargetRecordBase & (
  | Readonly<{phase: "reserved"; targetId: null; createSent: boolean}>
  | Readonly<{phase: "owned"; targetId: string}>
)

export class StorybookBrowserState {
  readonly #root: string

  constructor(root: string) {
    this.#root = resolve(root)
    ensurePrivateDirectory(this.#root)
  }

  secret(): Uint8Array {
    const path = join(this.#root, "view-secret")
    if (!existsSync(path)) {
      try {
        writePrivateFile(path, `${randomBytes(32).toString("base64url")}\n`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      }
    }
    const value = readFileSync(path, "utf8").trim()
    if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new Error("Invalid Storybook browser view secret")
    chmodSync(path, 0o600)
    return new Uint8Array(Buffer.from(value, "base64url"))
  }

  readTarget(packageId: string): StorybookBrowserTargetRecord | null {
    const exactPackage = validatePackageId(packageId)
    const path = this.#targetPath(exactPackage)
    if (!existsSync(path)) return null
    let value: unknown
    try {
      value = JSON.parse(readFileSync(path, "utf8"))
    } catch (error) {
      throw new Error(`Cannot read Storybook browser target record for ${exactPackage}`, {cause: error})
    }
    return validateRecord(value, exactPackage)
  }

  writeTarget(input: Readonly<{
    packageId: string
    cdpOrigin: string
    browserIdentity: string
    targetId: string
  }>): StorybookBrowserTargetRecord {
    const packageId = validatePackageId(input.packageId)
    const cdpOrigin = loopbackOrigin(input.cdpOrigin)
    const targetId = exactTargetId(input.targetId)
    const browserIdentity = exactBrowserIdentity(input.browserIdentity)
    const previous = this.readTarget(packageId)
    const record = Object.freeze({
      protocol: TARGET_RECORD_PROTOCOL,
      packageId,
      cdpOrigin,
      browserIdentity,
      phase: "owned" as const,
      targetId,
      url: previous?.url ?? null,
      baselineTargetIds: previous?.baselineTargetIds ?? Object.freeze([]),
      recordedAt: new Date().toISOString(),
    })
    return this.#writeRecord(record)
  }

  reserveTarget(input: Readonly<{
    packageId: string
    cdpOrigin: string
    browserIdentity: string
    url: string
    baselineTargetIds: readonly string[]
  }>): StorybookBrowserTargetRecord {
    const record = Object.freeze({
      protocol: TARGET_RECORD_PROTOCOL,
      packageId: validatePackageId(input.packageId),
      cdpOrigin: loopbackOrigin(input.cdpOrigin),
      browserIdentity: exactBrowserIdentity(input.browserIdentity),
      phase: "reserved" as const,
      targetId: null,
      createSent: false,
      url: exactHttpUrl(input.url),
      baselineTargetIds: exactTargetIds(input.baselineTargetIds),
      recordedAt: new Date().toISOString(),
    })
    return this.#writeRecord(record)
  }

  markCreateSent(packageId: string): StorybookBrowserTargetRecord {
    const record = this.readTarget(packageId)
    if (record === null || record.phase !== "reserved") {
      throw new Error(`Storybook package target has no reservation: ${packageId}`)
    }
    return this.#writeRecord(Object.freeze({...record, createSent: true}))
  }

  clearTarget(packageId: string, expectedTargetId?: string): boolean {
    const record = this.readTarget(packageId)
    if (record === null || expectedTargetId !== undefined && record.targetId !== expectedTargetId) return false
    unlinkSync(this.#targetPath(record.packageId))
    return true
  }

  lockRoot(): string {
    const path = join(this.#root, "locks")
    ensurePrivateDirectory(path)
    return path
  }

  #targetPath(packageId: string): string {
    const digest = createHash("sha256").update(packageId).digest("hex")
    return join(this.#root, `target-${digest}.json`)
  }

  #writeRecord(record: StorybookBrowserTargetRecord): StorybookBrowserTargetRecord {
    const path = this.#targetPath(record.packageId)
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
    writePrivateFile(temporary, `${JSON.stringify(record)}\n`)
    renameSync(temporary, path)
    chmodSync(path, 0o600)
    return record
  }
}

function validateRecord(value: unknown, packageId: string): StorybookBrowserTargetRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid Storybook browser target record: ${packageId}`)
  }
  const record = value as Record<string, unknown>
  if (record.protocol !== TARGET_RECORD_PROTOCOL && !LEGACY_TARGET_RECORD_PROTOCOLS.has(String(record.protocol)) ||
    record.packageId !== packageId ||
    typeof record.recordedAt !== "string" || !Number.isFinite(Date.parse(record.recordedAt))) {
    throw new Error(`Storybook browser target record identity mismatch: ${packageId}`)
  }
  const cdpOrigin = loopbackOrigin(String(record.cdpOrigin))
  if (record.protocol !== TARGET_RECORD_PROTOCOL) return Object.freeze({
    protocol: TARGET_RECORD_PROTOCOL,
    packageId,
    cdpOrigin,
    browserIdentity: String(record.protocol).endsWith("/2")
      ? exactBrowserIdentity(record.browserIdentity)
      : null,
    phase: "owned",
    targetId: exactTargetId(record.targetId),
    url: null,
    baselineTargetIds: Object.freeze([]),
    recordedAt: record.recordedAt,
  })
  const phase = record.phase
  if (phase !== "reserved" && phase !== "owned") {
    throw new Error(`Storybook browser target phase is invalid: ${packageId}`)
  }
  const common = {
    protocol: TARGET_RECORD_PROTOCOL,
    packageId,
    cdpOrigin,
    browserIdentity: exactBrowserIdentity(record.browserIdentity),
    url: record.url === null ? null : exactHttpUrl(record.url),
    baselineTargetIds: exactTargetIds(record.baselineTargetIds),
    recordedAt: record.recordedAt,
  } as const
  return phase === "owned"
    ? Object.freeze({...common, phase, targetId: exactTargetId(record.targetId)})
    : Object.freeze({
      ...common,
      phase,
      targetId: null,
      createSent: typeof record.createSent === "boolean" ? record.createSent : false,
    })
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, {recursive: true, mode: 0o700})
  chmodSync(path, 0o700)
}

function writePrivateFile(path: string, value: string): void {
  writeFileSync(path, value, {flag: "wx", mode: 0o600})
  chmodSync(path, 0o600)
}

function validatePackageId(value: unknown): string {
  if (typeof value !== "string" || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(value)) {
    throw new Error(`Invalid Storybook browser package identity: ${String(value)}`)
  }
  return value
}

function exactTargetId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/u.test(value)) {
    throw new Error("Invalid Storybook browser target identity")
  }
  return value
}

function exactBrowserIdentity(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("Invalid Storybook browser instance identity")
  }
  return value
}

function exactTargetIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 4_096) {
    throw new Error("Invalid Storybook browser target reservation inventory")
  }
  const ids = value.map(exactTargetId)
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate Storybook browser target reservation identity")
  }
  return Object.freeze(ids)
}

function exactHttpUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid Storybook browser target reservation URL")
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Invalid Storybook browser target reservation URL")
  }
  return url.href
}

function loopbackOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`Storybook CDP origin must be loopback HTTP: ${value}`)
  }
  return url.origin
}
