import {existsSync} from "node:fs"
import {isAbsolute, resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {initExternalStorybookDeclaration} from "./init.ts"
import {
  acquireExternalStorybookStartLease,
  inspectExternalStorybookServer,
  removeReplaceableExternalStorybookState,
} from "./server-state.ts"
import {startExternalStorybookServer} from "./server.ts"

export type ExternalStorybookCliIo = Readonly<{
  stdout(value: string): void
  stderr(value: string): void
}>

export type ExternalStorybookCliCommand =
  | Readonly<{action: "serve", declarations: readonly string[]}>
  | Readonly<{action: "attach", path: string}>
  | Readonly<{action: "detach", scopeId: string}>
  | Readonly<{action: "open", packageId: string, route: string}>
  | Readonly<{action: "status"}>
  | Readonly<{action: "check", scope: string | null}>
  | Readonly<{action: "stop"}>
  | Readonly<{
    action: "init"
    root: string
    kind: "workspace" | "project" | "package"
    executable: boolean
    stories: boolean
  }>

export async function runExternalStorybookCli(
  args: readonly string[],
  io: ExternalStorybookCliIo = consoleIo,
): Promise<number> {
  const command = parseExternalStorybookCli(args)
  if (command.action === "init") {
    const result = await initExternalStorybookDeclaration({
      root: inputPath(command.root),
      kind: command.kind,
      executable: command.executable,
      stories: command.stories,
    })
    io.stdout(json({action: "init", ...result}))
    return 0
  }

  let inspection = await inspectExternalStorybookServer()
  if (command.action === "serve") {
    if (inspection.state === "running" && inspection.record !== null) {
      for (const path of command.declarations) {
        await request(inspection.record.origin, "/api/attach", {path: inputPath(path)})
      }
      io.stdout(json({action: "serve", outcome: "already-running", ...await status(inspection.record.origin)}))
      return 0
    }
    const lease = acquireExternalStorybookStartLease()
    let running: Awaited<ReturnType<typeof startExternalStorybookServer>> | null = null
    try {
      inspection = await inspectExternalStorybookServer()
      if (inspection.state === "running" && inspection.record !== null) {
        for (const path of command.declarations) {
          await request(inspection.record.origin, "/api/attach", {path: inputPath(path)})
        }
        io.stdout(json({action: "serve", outcome: "already-running", ...await status(inspection.record.origin)}))
        return 0
      }
      if (inspection.state === "stale") {
        if (!inspection.replaceable) {
          throw new Error(`Refusing to replace ambiguous external Storybook state: ${inspection.reason}`)
        }
        removeReplaceableExternalStorybookState(inspection)
      }
      running = await startExternalStorybookServer({
        declarations: command.declarations.map(inputPath),
      })
    } finally {
      lease.release()
    }
    if (running === null) throw new Error("External Storybook server did not start")
    io.stdout(json({action: "serve", outcome: "started", origin: running.origin, record: running.record}))
    const stop = (): void => running.stop()
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
    await running.stopped
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
    return 0
  }

  if (inspection.state !== "running" || inspection.record === null) {
    if (command.action === "status") {
      io.stdout(json({action: "status", ...inspection}))
      return inspection.state === "stale" ? 1 : 0
    }
    if (command.action === "check" && command.scope !== null && pathLike(command.scope)) {
      const lease = acquireExternalStorybookStartLease()
      let running: Awaited<ReturnType<typeof startExternalStorybookServer>> | null = null
      try {
        inspection = await inspectExternalStorybookServer()
        if (inspection.state === "running") {
          throw new Error("External Storybook server started concurrently; retry check against it")
        }
        if (inspection.state === "stale") {
          if (!inspection.replaceable) {
            throw new Error(`Refusing to replace ambiguous external Storybook state: ${inspection.reason}`)
          }
          removeReplaceableExternalStorybookState(inspection)
        }
        running = await startExternalStorybookServer({declarations: [inputPath(command.scope)]})
      } finally {
        lease.release()
      }
      if (running === null) throw new Error("External Storybook transient check server did not start")
      try {
        const result = await request(running.origin, "/api/check", {scope: null}, true)
        io.stdout(json({action: "check", transient: true, ...summarizeCheck(result.body)}))
        return result.response.ok ? 0 : 1
      } finally {
        running.stop()
        await running.stopped
      }
    }
    throw new Error(`External Storybook server is not running: ${command.action}`)
  }

  const origin = inspection.record.origin
  if (command.action === "status") {
    io.stdout(json({action: "status", ...(await status(origin))}))
    return 0
  }
  if (command.action === "attach") {
    const result = await request(origin, "/api/attach", {path: inputPath(command.path)})
    io.stdout(json({action: "attach", ...result.body}))
    return 0
  }
  if (command.action === "detach") {
    const result = await request(origin, "/api/detach", {scopeId: command.scopeId})
    io.stdout(json({action: "detach", ...result.body}))
    return 0
  }
  if (command.action === "open") {
    const result = await request(origin, "/api/open", {
      packageId: command.packageId,
      route: command.route,
    })
    let browserOpened = false
    if (result.body.delivered === 0) {
      const child = Bun.spawn([
        process.execPath,
        fileURLToPath(new URL("../../scripts/storybook-browser.ts", import.meta.url)),
        "open",
        command.packageId,
        ...(command.route.length === 0 ? [] : ["--route", command.route]),
      ], {
        cwd: process.cwd(),
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
      const exitCode = await child.exited
      if (exitCode !== 0) throw new Error(`External Storybook browser open failed: ${exitCode}`)
      browserOpened = true
    }
    io.stdout(json({action: "open", browserOpened, ...result.body}))
    return 0
  }
  if (command.action === "check") {
    const result = await request(origin, "/api/check", {
      scope: normalizeExternalStorybookCheckScope(command.scope),
    }, true)
    io.stdout(json({action: "check", ...summarizeCheck(result.body)}))
    return result.response.ok ? 0 : 1
  }
  if (command.action === "stop") {
    const result = await request(origin, "/api/stop", {})
    io.stdout(json({action: "stop", ...result.body}))
    return 0
  }
  command satisfies never
  return 1
}

export function parseExternalStorybookCli(args: readonly string[]): ExternalStorybookCliCommand {
  const [action, ...rest] = args
  if (action === "serve") return Object.freeze({action, declarations: Object.freeze([...rest])})
  if (action === "attach" && rest.length === 1) return Object.freeze({action, path: rest[0]!})
  if (action === "detach" && rest.length === 1) return Object.freeze({action, scopeId: rest[0]!})
  if (action === "open" && (rest.length === 1 || rest.length === 2)) {
    return Object.freeze({action, packageId: rest[0]!, route: rest[1] ?? ""})
  }
  if (action === "status" && rest.length === 0) return Object.freeze({action})
  if (action === "check" && rest.length <= 1) return Object.freeze({action, scope: rest[0] ?? null})
  if (action === "stop" && rest.length === 0) return Object.freeze({action})
  if (action === "init") return parseInit(rest)
  usage()
}

function parseInit(args: readonly string[]): ExternalStorybookCliCommand {
  const root = args[0]
  if (root === undefined) usage()
  let kind: "workspace" | "project" | "package" | null = null
  let executable = false
  let stories = false
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--executable") {
      executable = true
      continue
    }
    if (argument === "--stories") {
      stories = true
      continue
    }
    if (argument !== "--kind" || kind !== null) usage()
    const value = args[index + 1]
    if (value !== "workspace" && value !== "project" && value !== "package") usage()
    kind = value
    index += 1
  }
  if (kind === null) usage()
  if ((executable || stories) && kind !== "package") usage()
  return Object.freeze({action: "init", root, kind, executable, stories})
}

function usage(): never {
  throw new Error([
    "Usage:",
    "  storybook serve [declaration-or-root...]",
    "  storybook attach <declaration-or-root>",
    "  storybook detach <scope-id>",
    "  storybook open <package-id> [route]",
    "  storybook status",
    "  storybook check [scope-id-or-path]",
    "  storybook stop",
    "  storybook init <root> --kind <package|project|workspace> [--executable] [--stories]",
  ].join("\n"))
}

async function status(origin: string): Promise<Record<string, unknown>> {
  const body = (await request(origin, "/api/status", {}, false, "GET")).body
  return {
    ...body,
    packages: summarizePackages(body.packages),
  }
}

function summarizeCheck(body: Record<string, unknown>): Record<string, unknown> {
  return {...body, packages: summarizePackages(body.packages)}
}

function summarizePackages(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((candidate) => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return candidate
    const snapshot = candidate as Record<string, unknown>
    return {
      packageId: snapshot.packageId,
      buildState: snapshot.buildState,
      activeRevision: snapshot.activeRevision,
      lastGoodRevision: snapshot.lastGoodRevision,
      moduleGraphRevision: snapshot.moduleGraphRevision,
      diagnostics: snapshot.diagnostics,
      dependencyCount: Array.isArray(snapshot.dependencyRealpaths)
        ? snapshot.dependencyRealpaths.length
        : 0,
      builds: snapshot.builds,
    }
  })
}

async function request(
  origin: string,
  path: string,
  body: unknown,
  allowFailure = false,
  method = "POST",
): Promise<Readonly<{response: Response, body: Record<string, unknown>}>> {
  const response = await fetch(new URL(path, origin), {
    method,
    ...(method === "GET" ? {} : {
      headers: {"content-type": "application/json"},
      body: JSON.stringify(body),
    }),
    signal: AbortSignal.timeout(120_000),
  })
  const value = await response.json() as unknown
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`External Storybook returned an invalid response: ${path}`)
  }
  const record = value as Record<string, unknown>
  if (!response.ok && !allowFailure) {
    throw new Error(typeof record.error === "string" ? record.error : `External Storybook request failed: ${response.status}`)
  }
  return Object.freeze({response, body: record})
}

function pathLike(value: string): boolean {
  return isAbsolute(value) || value.startsWith(".") || existsSync(inputPath(value))
}

/** Preserves registry identities while canonicalizing path-like check scopes at the caller boundary. */
export function normalizeExternalStorybookCheckScope(
  value: string | null,
  invocationCwd = Bun.env.STORYBOOK_INVOCATION_CWD ?? process.cwd(),
): string | null {
  if (value === null) return null
  if (isAbsolute(value) || value.startsWith(".") || existsSync(resolve(invocationCwd, value))) {
    return resolve(invocationCwd, value)
  }
  return value
}

function inputPath(value: string): string {
  return resolve(Bun.env.STORYBOOK_INVOCATION_CWD ?? process.cwd(), value)
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

const consoleIo: ExternalStorybookCliIo = Object.freeze({
  stdout: (value) => console.log(value),
  stderr: (value) => console.error(value),
})
