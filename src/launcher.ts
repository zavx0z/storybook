/**
Package-name launcher for repository-owned Storybooks.

The exact `package.json#name` is the only user-facing process identity. The
launcher resolves that package inside one supplied repository, delegates to its
`storybook` script, requests an OS-allocated port and validates the exact child
before status or stop operations.

@packageDocumentation
*/

import {existsSync, realpathSync, unlinkSync} from "node:fs"
import {dirname, join, resolve} from "node:path"
import {
  processExists,
  readProcessDirectory,
  readProcessStart,
  readStorybookPackageManifest,
  readStorybookRuntimeRecord,
  readStorybookStopRequest,
  STORYBOOK_RUNTIME_PROTOCOL_VERSION,
  storybookRuntimeStatePath,
  storybookStopRequestPath,
  validateStorybookPackageName,
  writeStorybookStopRequest,
  type StorybookRuntimeRecord,
} from "./internal/package-runtime.ts"

export type StorybookPackageIdentity = Readonly<{
  name: string
  repositoryRoot: string
  directory: string
  manifestPath: string
  script: string
  statePath: string
}>

export type StorybookPackageStatus = Readonly<{
  package: StorybookPackageIdentity
  status: "stopped" | "running" | "stale"
  runtime: StorybookRuntimeRecord | null
  healthy: boolean
  replaceable: boolean
  reason: string | null
}>

export type StorybookLaunchResult = Readonly<{
  package: StorybookPackageIdentity
  runtime: StorybookRuntimeRecord
  child: ReturnType<typeof Bun.spawn> | null
  outcome: "already-running" | "started"
}>

export type StorybookPackageResolverOptions = Readonly<{
  cwd?: string
  repositoryRoot?: string
  stateRoot?: string
}>

/** Resolves one exact `@scope/storybook` workspace package without aliases. */
export async function resolveStorybookPackage(
  packageName: string,
  options: StorybookPackageResolverOptions = {},
): Promise<StorybookPackageIdentity> {
  const name = validateStorybookPackageName(packageName)
  const cwd = realpathSync(options.cwd ?? process.cwd())
  const repositoryRoot = realpathSync(options.repositoryRoot ?? readGitRoot(cwd))
  const manifests = new Set<string>([join(repositoryRoot, "package.json")])
  const glob = new Bun.Glob("**/package.json")
  for await (const relativePath of glob.scan({cwd: repositoryRoot, onlyFiles: true, dot: true})) {
    if (relativePath.split("/").some((part) => [".git", "node_modules", "dist", "coverage"].includes(part))) continue
    manifests.add(join(repositoryRoot, relativePath))
  }
  const matches: StorybookPackageIdentity[] = []
  for (const manifestPath of [...manifests].sort()) {
    if (!existsSync(manifestPath)) continue
    let manifest: unknown
    try {
      manifest = await Bun.file(manifestPath).json()
    } catch {
      continue
    }
    if (manifest === null || typeof manifest !== "object" || (manifest as Record<string, unknown>).name !== name) continue
    const directory = realpathSync(dirname(manifestPath))
    const packageManifest = readStorybookPackageManifest(directory)
    matches.push(Object.freeze({
      name,
      repositoryRoot,
      directory,
      manifestPath,
      script: packageManifest.storybookScript,
      statePath: storybookRuntimeStatePath(name, directory, options.stateRoot),
    }))
  }
  if (matches.length === 0) throw new Error(`Storybook package was not found in ${repositoryRoot}: ${name}`)
  if (matches.length > 1) {
    throw new Error(`Storybook package name is ambiguous in ${repositoryRoot}: ${name}\n${matches.map(({manifestPath}) => manifestPath).join("\n")}`)
  }
  return matches[0]!
}

/** Reads exact process and HTTP health without mutating stale state. */
export async function inspectStorybookPackage(
  packageIdentity: StorybookPackageIdentity,
): Promise<StorybookPackageStatus> {
  if (!existsSync(packageIdentity.statePath)) return status(packageIdentity, "stopped", null, false, true, null)
  let runtime: StorybookRuntimeRecord
  try {
    runtime = readStorybookRuntimeRecord(packageIdentity.statePath)
  } catch (error) {
    return status(packageIdentity, "stale", null, false, false, errorText(error))
  }
  if (runtime.packageName !== packageIdentity.name ||
    safeRealpath(runtime.packageDirectory) !== packageIdentity.directory) {
    return status(packageIdentity, "stale", runtime, false, false, "runtime package identity does not match")
  }
  if (!processExists(runtime.pid)) {
    return status(packageIdentity, "stale", runtime, false, true, "runtime process does not exist")
  }
  if (readProcessStart(runtime.pid) !== runtime.processStart) {
    return status(packageIdentity, "stale", runtime, false, false, "runtime PID was reused")
  }
  if (readProcessDirectory(runtime.pid) !== packageIdentity.directory) {
    return status(packageIdentity, "stale", runtime, false, false, "runtime working directory does not match")
  }
  const healthy = await runtimeHealth(runtime)
  return status(
    packageIdentity,
    healthy ? "running" : "stale",
    runtime,
    healthy,
    false,
    healthy ? null : "runtime health request failed",
  )
}

/** Starts one exact package and waits for its automatic-port runtime record. */
export async function launchStorybookPackage(
  packageIdentity: StorybookPackageIdentity,
  options: Readonly<{ensure?: boolean, waitMs?: number}> = {},
): Promise<StorybookLaunchResult> {
  const current = await inspectStorybookPackage(packageIdentity)
  if (current.status === "running" && current.runtime !== null) {
    if (options.ensure === true) {
      return Object.freeze({package: packageIdentity, runtime: current.runtime, child: null, outcome: "already-running"})
    }
    throw new Error(`Storybook package is already running: ${packageIdentity.name}`)
  }
  if (current.status === "stale") {
    if (!current.replaceable) throw new Error(`Refusing to replace ambiguous Storybook state: ${current.reason ?? packageIdentity.statePath}`)
    unlinkIfExists(packageIdentity.statePath)
  }
  unlinkIfExists(storybookStopRequestPath(packageIdentity.statePath))
  const child = Bun.spawn(["bun", "run", "storybook"], {
    cwd: packageIdentity.directory,
    env: {
      ...Bun.env,
      STORYBOOK_PACKAGE_NAME: packageIdentity.name,
      STORYBOOK_PORT: "0",
      STORYBOOK_STATE_FILE: packageIdentity.statePath,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const deadline = Date.now() + (options.waitMs ?? 15_000)
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Storybook package exited before readiness: ${packageIdentity.name} (${child.exitCode})`)
    }
    const next = await inspectStorybookPackage(packageIdentity)
    if (next.status === "running" && next.runtime !== null) {
      return Object.freeze({package: packageIdentity, runtime: next.runtime, child, outcome: "started"})
    }
    await Bun.sleep(50)
  }
  child.kill("SIGTERM")
  throw new Error(`Storybook package did not publish readiness within ${options.waitMs ?? 15_000}ms: ${packageIdentity.name}`)
}

/** Stops only the exact recorded package child and never escalates to SIGKILL. */
export async function stopStorybookPackage(
  packageIdentity: StorybookPackageIdentity,
  reason: "restart" | "stop" = "stop",
  waitMs = 5_000,
): Promise<StorybookPackageStatus> {
  const current = await inspectStorybookPackage(packageIdentity)
  if (current.status === "stopped") return current
  if (current.status !== "running" || current.runtime === null) {
    throw new Error(`Refusing to stop unowned Storybook state: ${current.reason ?? packageIdentity.statePath}`)
  }
  const runtime = current.runtime
  writeStorybookStopRequest(storybookStopRequestPath(packageIdentity.statePath), Object.freeze({
    protocolVersion: STORYBOOK_RUNTIME_PROTOCOL_VERSION,
    packageName: runtime.packageName,
    packageDirectory: runtime.packageDirectory,
    pid: runtime.pid,
    processStart: runtime.processStart,
    reason,
    requestedAt: new Date().toISOString(),
  }))
  process.kill(runtime.pid, "SIGTERM")
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline && processExists(runtime.pid)) await Bun.sleep(50)
  if (processExists(runtime.pid)) {
    throw new Error(`Storybook package did not stop after SIGTERM; no escalation was attempted: ${packageIdentity.name}`)
  }
  unlinkIfSameRuntime(packageIdentity.statePath, runtime)
  return status(packageIdentity, "stopped", null, false, true, null)
}

/** Matches the exact external stop request consumed by a foreground owner. */
export function storybookExitWasRequested(
  packageIdentity: StorybookPackageIdentity,
  runtime: StorybookRuntimeRecord,
): boolean {
  const request = readStorybookStopRequest(storybookStopRequestPath(packageIdentity.statePath))
  return request !== null &&
    request.packageName === runtime.packageName &&
    request.packageDirectory === runtime.packageDirectory &&
    request.pid === runtime.pid &&
    request.processStart === runtime.processStart
}

/** Removes only the exact consumed stop request. */
export function clearStorybookStopRequest(packageIdentity: StorybookPackageIdentity): void {
  unlinkIfExists(storybookStopRequestPath(packageIdentity.statePath))
}

function status(
  packageIdentity: StorybookPackageIdentity,
  state: StorybookPackageStatus["status"],
  runtime: StorybookRuntimeRecord | null,
  healthy: boolean,
  replaceable: boolean,
  reason: string | null,
): StorybookPackageStatus {
  return Object.freeze({package: packageIdentity, status: state, runtime, healthy, replaceable, reason})
}

function readGitRoot(cwd: string): string {
  const result = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--show-toplevel"])
  if (result.exitCode !== 0) throw new Error(`Storybook launcher requires a Git repository: ${cwd}`)
  const root = result.stdout.toString().trim()
  if (root.length === 0) throw new Error(`Git returned an empty repository root: ${cwd}`)
  return resolve(root)
}

async function runtimeHealth(runtime: StorybookRuntimeRecord): Promise<boolean> {
  try {
    const response = await fetch(new URL(runtime.healthPath, runtime.origin), {
      signal: AbortSignal.timeout(1_500),
      redirect: "manual",
    })
    return response.status === 200
  } catch {
    return false
  }
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

function unlinkIfExists(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

function unlinkIfSameRuntime(path: string, runtime: StorybookRuntimeRecord): void {
  try {
    const current = readStorybookRuntimeRecord(path)
    if (current.pid === runtime.pid && current.processStart === runtime.processStart) unlinkIfExists(path)
  } catch {
    // Leave unreadable or replaced state untouched for explicit diagnosis.
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
