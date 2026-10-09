import {randomBytes, randomUUID} from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import {join, resolve} from "node:path"

const TARGET_RECORD_PROTOCOL = "external-storybook-browser-workspace/1" as const
const LEGACY_TARGET_RECORD_PROTOCOLS = new Set([
  "external-storybook-browser-target/1",
  "external-storybook-browser-target/2",
  "external-storybook-browser-target/3",
])

type StorybookBrowserTargetRecordBase = Readonly<{
  protocol: typeof TARGET_RECORD_PROTOCOL
  packageId: string | null
  cdpOrigin: string
  browserIdentity: string | null
  url: string | null
  baselineTargetIds: readonly string[]
  recordedAt: string
  viewName: string | null
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

  hasWorkspace(): boolean {
    return existsSync(this.#targetPath())
  }

  readWorkspace(): StorybookBrowserTargetRecord | null {
    const path = this.#targetPath()
    if (existsSync(path)) return this.#readRecord(path)
    const legacy = this.legacyRecords()
    // Отправленная legacy reservation остаётся глобальным запретом нового create.
    const selected = legacy.find(record => record.phase === "reserved" && record.createSent) ??
      legacy.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))[0]
    return selected ?? null
  }

  legacyRecords(): StorybookBrowserTargetRecord[] {
    const paths = readdirSync(this.#root).filter(name => /^target-[a-f0-9]{64}\.json$/u.test(name))
    if (paths.length > 4_096) throw new Error("Storybook legacy workspace inventory exceeds its migration bound")
    return paths.map(name => this.#readRecord(join(this.#root, name)))
  }

  #readRecord(path: string): StorybookBrowserTargetRecord {
    try {
      return validateRecord(JSON.parse(readFileSync(path, "utf8")))
    } catch (error) {
      throw new Error("Cannot read Storybook browser workspace record", {cause: error})
    }
  }

  writeWorkspace(input: Readonly<{
    packageId: string | null
    cdpOrigin: string
    browserIdentity: string
    targetId: string
    url?: string
    viewName?: string | undefined
  }>): StorybookBrowserTargetRecord {
    const packageId = input.packageId === null ? null : validatePackageId(input.packageId)
    const cdpOrigin = loopbackOrigin(input.cdpOrigin)
    const targetId = exactTargetId(input.targetId)
    const browserIdentity = exactBrowserIdentity(input.browserIdentity)
    const previous = this.readWorkspace()
    const previousViewName = previous?.viewName === "storybook:workspace" || previous?.packageId === packageId
      ? previous?.viewName ?? null : null
    const record = Object.freeze({
      protocol: TARGET_RECORD_PROTOCOL,
      packageId,
      cdpOrigin,
      browserIdentity,
      viewName: input.viewName === undefined ? previousViewName : exactViewName(input.viewName, packageId),
      phase: "owned" as const,
      targetId,
      url: input.url === undefined ? previous?.url ?? null : exactHttpUrl(input.url),
      baselineTargetIds: previous?.baselineTargetIds ?? Object.freeze([]),
      recordedAt: new Date().toISOString(),
    })
    return this.#writeRecord(record)
  }

  reserveWorkspace(input: Readonly<{
    packageId: string | null
    cdpOrigin: string
    browserIdentity: string
    url: string
    baselineTargetIds: readonly string[]
  }>): StorybookBrowserTargetRecord {
    const record = Object.freeze({
      protocol: TARGET_RECORD_PROTOCOL,
      packageId: input.packageId === null ? null : validatePackageId(input.packageId),
      cdpOrigin: loopbackOrigin(input.cdpOrigin),
      browserIdentity: exactBrowserIdentity(input.browserIdentity),
      viewName: null,
      phase: "reserved" as const,
      targetId: null,
      createSent: false,
      url: exactHttpUrl(input.url),
      baselineTargetIds: exactTargetIds(input.baselineTargetIds),
      recordedAt: new Date().toISOString(),
    })
    return this.#writeRecord(record)
  }

  markCreateSent(): StorybookBrowserTargetRecord {
    const record = this.readWorkspace()
    if (record === null || record.phase !== "reserved") {
      throw new Error(`Storybook workspace target has no reservation`)
    }
    return this.#writeRecord(Object.freeze({...record, createSent: true}))
  }

  clearWorkspace(expectedTargetId?: string): boolean {
    const record = this.readWorkspace()
    if (record === null || expectedTargetId !== undefined && record.targetId !== expectedTargetId) return false
    if (existsSync(this.#targetPath())) unlinkSync(this.#targetPath())
    for (const name of readdirSync(this.#root).filter(name => /^target-[a-f0-9]{64}\.json$/u.test(name))) {
      const path = join(this.#root, name)
      const legacy = this.#readRecord(path)
      if (legacy.targetId === record.targetId && legacy.packageId === record.packageId) unlinkSync(path)
    }
    return true
  }

  clearUnsentReservation(): boolean {
    const record = this.readWorkspace()
    if (record?.phase !== "reserved" || record.createSent) return false
    return this.clearWorkspace()
  }

  lockRoot(): string {
    const path = join(this.#root, "locks")
    ensurePrivateDirectory(path)
    return path
  }

  #targetPath(): string {
    return join(this.#root, "workspace.json")
  }

  #writeRecord(record: StorybookBrowserTargetRecord): StorybookBrowserTargetRecord {
    const path = this.#targetPath()
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
    writePrivateFile(temporary, `${JSON.stringify(record)}\n`)
    renameSync(temporary, path)
    chmodSync(path, 0o600)
    // Неизвестные legacy dispatch не очищаются при принятии существующего workspace.
    for (const name of readdirSync(this.#root).filter(name => /^target-[a-f0-9]{64}\.json$/u.test(name))) {
      const legacyPath = join(this.#root, name)
      const legacy = this.#readRecord(legacyPath)
      const reconciled = legacy.phase === "reserved" && record.phase === "owned" &&
        legacy.cdpOrigin === record.cdpOrigin && legacy.browserIdentity === record.browserIdentity &&
        record.url === legacy.url && !legacy.baselineTargetIds.includes(record.targetId)
      if (legacy.phase === "owned" || !legacy.createSent || reconciled) unlinkSync(legacyPath)
    }
    return record
  }
}

function validateRecord(value: unknown): StorybookBrowserTargetRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Storybook browser workspace record")
  }
  const record = value as Record<string, unknown>
  const packageId = record.packageId === null ? null : validatePackageId(record.packageId)
  if (record.protocol !== TARGET_RECORD_PROTOCOL && !LEGACY_TARGET_RECORD_PROTOCOLS.has(String(record.protocol)) ||
    typeof record.recordedAt !== "string" || !Number.isFinite(Date.parse(record.recordedAt))) {
    throw new Error(`Storybook browser target record identity mismatch: ${packageId}`)
  }
  const cdpOrigin = loopbackOrigin(String(record.cdpOrigin))
  if (record.protocol === "external-storybook-browser-target/1" || record.protocol === "external-storybook-browser-target/2") return Object.freeze({
    protocol: TARGET_RECORD_PROTOCOL,
    packageId,
    cdpOrigin,
    browserIdentity: String(record.protocol).endsWith("/2")
      ? exactBrowserIdentity(record.browserIdentity)
      : null,
    viewName: null,
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
    viewName: record.viewName === null || record.viewName === undefined ? null : exactViewName(record.viewName, packageId),
  } as const
  return phase === "owned"
    ? Object.freeze({...common, phase, targetId: exactTargetId(record.targetId)})
    : Object.freeze({
      ...common,
      phase,
      targetId: null,
      // У старой записи без маркера нет доказательства, что команда не отправлялась.
      createSent: typeof record.createSent === "boolean" ? record.createSent : true,
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

function exactViewName(value: unknown, packageId: string | null): string {
  if (value === "storybook:workspace" || packageId !== null && value === `storybook:${packageId}`) return String(value)
  throw new Error("Invalid Storybook browser workspace name")
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
