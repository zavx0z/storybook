import {createHash, randomUUID} from "node:crypto"
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import {dirname, isAbsolute, join} from "node:path"
import {tmpdir} from "node:os"

export const STORYBOOK_RUNTIME_PROTOCOL_VERSION = 1 as const

export type StorybookRuntimeRecord = Readonly<{
  protocolVersion: typeof STORYBOOK_RUNTIME_PROTOCOL_VERSION
  packageName: string
  packageDirectory: string
  pid: number
  processStart: string
  origin: string
  healthPath: string
  manifestPath: string
  appId: string
  basePath: string
  startedAt: string
}>

export type StorybookStopRequest = Readonly<{
  protocolVersion: typeof STORYBOOK_RUNTIME_PROTOCOL_VERSION
  packageName: string
  packageDirectory: string
  pid: number
  processStart: string
  reason: "restart" | "stop"
  requestedAt: string
}>

export function validateStorybookPackageName(value: string): string {
  if (!/^@[a-z0-9][a-z0-9._-]*\/storybook$/u.test(value)) {
    throw new Error(`Storybook package name must be exact @scope/storybook: ${value}`)
  }
  return value
}

export function readStorybookPackageManifest(directory: string): Readonly<{
  name: string
  storybookScript: string
}> {
  const packageDirectory = realpathSync(directory)
  const manifestPath = join(packageDirectory, "package.json")
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  } catch (error) {
    throw new Error(`Cannot read Storybook package manifest: ${manifestPath}`, {cause: error})
  }
  if (manifest === null || typeof manifest !== "object") {
    throw new Error(`Storybook package manifest must be an object: ${manifestPath}`)
  }
  const record = manifest as Record<string, unknown>
  const name = validateStorybookPackageName(String(record.name ?? ""))
  if (record.private !== true || record.type !== "module") {
    throw new Error(`Storybook package must be private ESM: ${name}`)
  }
  const scripts = record.scripts
  if (scripts === null || typeof scripts !== "object") {
    throw new Error(`Storybook package must declare scripts.storybook: ${name}`)
  }
  const packageScripts = scripts as Record<string, unknown>
  for (const script of ["storybook", "build", "test", "typecheck", "check"]) {
    if (typeof packageScripts[script] !== "string" || packageScripts[script].trim().length === 0) {
      throw new Error(`Storybook package must declare scripts.${script}: ${name}`)
    }
  }
  const storybookScript = packageScripts.storybook as string
  const bunfigPath = join(packageDirectory, "bunfig.toml")
  let bunfig: string
  try {
    bunfig = readFileSync(bunfigPath, "utf8")
  } catch (error) {
    throw new Error(`Storybook package must own bunfig.toml: ${name}`, {cause: error})
  }
  if (!/^\[install\][\s\S]*?^peer\s*=\s*false\s*$/mu.test(bunfig) ||
    !/^\[loader\][\s\S]*?^"\.wgsl"\s*=\s*"text"\s*$/mu.test(bunfig)) {
    throw new Error(`Storybook package bunfig must disable peer install and load WGSL as text: ${name}`)
  }
  return Object.freeze({name, storybookScript})
}

export function storybookRuntimeStatePath(
  packageName: string,
  packageDirectory: string,
  stateRoot = join(tmpdir(), "zavx0z-storybook"),
): string {
  const name = validateStorybookPackageName(packageName)
  const directory = realpathSync(packageDirectory)
  const digest = createHash("sha256")
    .update(`${name}\0${directory}`)
    .digest("hex")
    .slice(0, 20)
  return join(stateRoot, `${name.slice(1).replaceAll("/", "-")}-${digest}.json`)
}

export function storybookStopRequestPath(statePath: string): string {
  return `${statePath}.request.json`
}

export function writeStorybookRuntimeRecord(path: string, record: StorybookRuntimeRecord): void {
  if (!isAbsolute(path)) throw new Error(`Storybook runtime state path must be absolute: ${path}`)
  mkdirSync(dirname(path), {recursive: true})
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {flag: "wx"})
  renameSync(temporaryPath, path)
}

export function readStorybookRuntimeRecord(path: string): StorybookRuntimeRecord {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Error(`Cannot read Storybook runtime state: ${path}`, {cause: error})
  }
  if (value === null || typeof value !== "object") {
    throw new Error(`Storybook runtime state must be an object: ${path}`)
  }
  const record = value as Record<string, unknown>
  const protocolVersion = record.protocolVersion
  const packageName = validateStorybookPackageName(String(record.packageName ?? ""))
  const packageDirectory = String(record.packageDirectory ?? "")
  const pid = Number(record.pid)
  const processStart = String(record.processStart ?? "")
  const origin = String(record.origin ?? "")
  const healthPath = String(record.healthPath ?? "")
  const manifestPath = String(record.manifestPath ?? "")
  const appId = String(record.appId ?? "")
  const basePath = String(record.basePath ?? "")
  const startedAt = String(record.startedAt ?? "")
  if (protocolVersion !== STORYBOOK_RUNTIME_PROTOCOL_VERSION) {
    throw new Error(`Unsupported Storybook runtime protocol: ${String(protocolVersion)}`)
  }
  if (!isAbsolute(packageDirectory)) throw new Error(`Invalid Storybook package directory: ${packageDirectory}`)
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid Storybook runtime PID: ${String(record.pid)}`)
  if (processStart.length === 0) throw new Error("Storybook runtime state has no process start identity")
  const parsedOrigin = new URL(origin)
  if (parsedOrigin.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsedOrigin.hostname)) {
    throw new Error(`Storybook runtime origin must be loopback HTTP: ${origin}`)
  }
  if (!healthPath.startsWith("/") || healthPath.includes("//")) {
    throw new Error(`Invalid Storybook health path: ${healthPath}`)
  }
  if (!manifestPath.startsWith("/") || manifestPath.includes("//")) {
    throw new Error(`Invalid Storybook manifest path: ${manifestPath}`)
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(appId)) throw new Error(`Invalid Storybook app id: ${appId}`)
  if (!Number.isFinite(Date.parse(startedAt))) throw new Error(`Invalid Storybook start time: ${startedAt}`)
  return Object.freeze({
    protocolVersion,
    packageName,
    packageDirectory,
    pid,
    processStart,
    origin: parsedOrigin.origin,
    healthPath,
    manifestPath,
    appId,
    basePath,
    startedAt,
  })
}

export function writeStorybookStopRequest(path: string, request: StorybookStopRequest): void {
  if (!isAbsolute(path)) throw new Error(`Storybook stop-request path must be absolute: ${path}`)
  mkdirSync(dirname(path), {recursive: true})
  writeFileSync(path, `${JSON.stringify(request, null, 2)}\n`)
}

export function readStorybookStopRequest(path: string): StorybookStopRequest | null {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
  if (value === null || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  if (record.protocolVersion !== STORYBOOK_RUNTIME_PROTOCOL_VERSION) return null
  const packageName = String(record.packageName ?? "")
  const packageDirectory = String(record.packageDirectory ?? "")
  const pid = Number(record.pid)
  const processStart = String(record.processStart ?? "")
  const reason = record.reason
  const requestedAt = String(record.requestedAt ?? "")
  try {
    validateStorybookPackageName(packageName)
  } catch {
    return null
  }
  if (!isAbsolute(packageDirectory) || !Number.isSafeInteger(pid) || pid <= 0 || processStart.length === 0) return null
  if (reason !== "restart" && reason !== "stop") return null
  if (!Number.isFinite(Date.parse(requestedAt))) return null
  return Object.freeze({
    protocolVersion: STORYBOOK_RUNTIME_PROTOCOL_VERSION,
    packageName,
    packageDirectory,
    pid,
    processStart,
    reason,
    requestedAt,
  })
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
  const path = result.stdout.toString()
    .split(/\r?\n/u)
    .find((line) => line.startsWith("n"))
    ?.slice(1)
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
