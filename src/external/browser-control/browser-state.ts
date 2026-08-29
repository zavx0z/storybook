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
import {externalStorybookStateRoot} from "../server-state.ts"

const TARGET_RECORD_PROTOCOL = "external-storybook-browser-target/1" as const

export type StorybookBrowserTargetRecord = Readonly<{
  protocol: typeof TARGET_RECORD_PROTOCOL
  packageId: string
  cdpOrigin: string
  targetId: string
  recordedAt: string
}>

export class StorybookBrowserState {
  readonly #root: string

  constructor(root = join(externalStorybookStateRoot(), "browser")) {
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

  writeTarget(input: Readonly<{packageId: string; cdpOrigin: string; targetId: string}>): StorybookBrowserTargetRecord {
    const packageId = validatePackageId(input.packageId)
    const cdpOrigin = loopbackOrigin(input.cdpOrigin)
    const targetId = exactTargetId(input.targetId)
    const record = Object.freeze({
      protocol: TARGET_RECORD_PROTOCOL,
      packageId,
      cdpOrigin,
      targetId,
      recordedAt: new Date().toISOString(),
    })
    const path = this.#targetPath(packageId)
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
    writePrivateFile(temporary, `${JSON.stringify(record)}\n`)
    renameSync(temporary, path)
    chmodSync(path, 0o600)
    return record
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
}

function validateRecord(value: unknown, packageId: string): StorybookBrowserTargetRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid Storybook browser target record: ${packageId}`)
  }
  const record = value as Record<string, unknown>
  if (record.protocol !== TARGET_RECORD_PROTOCOL || record.packageId !== packageId ||
    typeof record.recordedAt !== "string" || !Number.isFinite(Date.parse(record.recordedAt))) {
    throw new Error(`Storybook browser target record identity mismatch: ${packageId}`)
  }
  return Object.freeze({
    protocol: TARGET_RECORD_PROTOCOL,
    packageId,
    cdpOrigin: loopbackOrigin(String(record.cdpOrigin)),
    targetId: exactTargetId(record.targetId),
    recordedAt: record.recordedAt,
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

function loopbackOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`Storybook CDP origin must be loopback HTTP: ${value}`)
  }
  return url.origin
}
