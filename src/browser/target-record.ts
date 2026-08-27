import {randomUUID} from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import {dirname, isAbsolute} from "node:path"

const STORYBOOK_BROWSER_TARGET_PROTOCOL_VERSION = 1 as const

export type StorybookBrowserTargetRecord = Readonly<{
  protocolVersion: typeof STORYBOOK_BROWSER_TARGET_PROTOCOL_VERSION
  packageName: string
  packageDirectory: string
  cdpPort: number
  targetId: string
  recordedAt: string
}>

export type StorybookBrowserTargetOwner = Readonly<{
  statePath: string
  packageName: string
  packageDirectory: string
  cdpPort: number
}>

export function storybookBrowserTargetRecordPath(statePath: string): string {
  if (!isAbsolute(statePath)) throw new Error(`Storybook state path must be absolute: ${statePath}`)
  return `${statePath}.browser-target.json`
}

export function readStorybookBrowserTargetRecord(
  owner: StorybookBrowserTargetOwner,
): StorybookBrowserTargetRecord | null {
  const path = storybookBrowserTargetRecordPath(owner.statePath)
  if (!existsSync(path)) return null
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Error(`Cannot read Storybook browser target record: ${path}`, {cause: error})
  }
  if (value === null || typeof value !== "object") {
    throw new Error(`Storybook browser target record must be an object: ${path}`)
  }
  const record = value as Record<string, unknown>
  if (record.protocolVersion !== STORYBOOK_BROWSER_TARGET_PROTOCOL_VERSION ||
    record.packageName !== owner.packageName ||
    record.packageDirectory !== owner.packageDirectory ||
    record.cdpPort !== owner.cdpPort ||
    typeof record.targetId !== "string" || record.targetId.length === 0 ||
    typeof record.recordedAt !== "string" || !Number.isFinite(Date.parse(record.recordedAt))) {
    throw new Error(`Storybook browser target identity does not match: ${path}`)
  }
  return Object.freeze({
    protocolVersion: STORYBOOK_BROWSER_TARGET_PROTOCOL_VERSION,
    packageName: owner.packageName,
    packageDirectory: owner.packageDirectory,
    cdpPort: owner.cdpPort,
    targetId: record.targetId,
    recordedAt: record.recordedAt,
  })
}

export function writeStorybookBrowserTargetRecord(
  owner: StorybookBrowserTargetOwner,
  targetId: string,
): StorybookBrowserTargetRecord {
  if (targetId.length === 0) throw new Error("Storybook browser target id must not be empty")
  const path = storybookBrowserTargetRecordPath(owner.statePath)
  const record = Object.freeze({
    protocolVersion: STORYBOOK_BROWSER_TARGET_PROTOCOL_VERSION,
    packageName: owner.packageName,
    packageDirectory: owner.packageDirectory,
    cdpPort: owner.cdpPort,
    targetId,
    recordedAt: new Date().toISOString(),
  })
  mkdirSync(dirname(path), {recursive: true})
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {flag: "wx"})
  renameSync(temporaryPath, path)
  return record
}

export function clearStorybookBrowserTargetRecord(
  owner: StorybookBrowserTargetOwner,
  expectedTargetId?: string,
): boolean {
  const record = readStorybookBrowserTargetRecord(owner)
  if (record === null || expectedTargetId !== undefined && record.targetId !== expectedTargetId) return false
  unlinkSync(storybookBrowserTargetRecordPath(owner.statePath))
  return true
}
