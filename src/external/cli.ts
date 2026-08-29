import {existsSync} from "node:fs"
import {isAbsolute, resolve} from "node:path"
import {createExternalStorybookController} from "./controller.ts"
import {initExternalStorybookDeclaration} from "./init.ts"

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
  const controller = createExternalStorybookController()
  const context = Object.freeze({signal: AbortSignal.timeout(120_000)})
  let result: Readonly<Record<string, unknown>>
  if (command.action === "serve") {
    result = await controller.ensure({
      schemaVersion: 1,
      roots: command.declarations.map(inputPath),
    }, context)
  } else if (command.action === "status") {
    result = await controller.status({schemaVersion: 1, includeViews: true}, context)
  } else if (command.action === "attach") {
    result = await controller.attach({schemaVersion: 1, root: inputPath(command.path)}, context)
  } else if (command.action === "detach") {
    result = await controller.detach({schemaVersion: 1, scopeId: command.scopeId}, context)
  } else if (command.action === "open") {
    result = await controller.open({
      schemaVersion: 1,
      packageId: command.packageId,
      route: command.route,
    }, context)
  } else if (command.action === "check") {
    result = await controller.check({
      schemaVersion: 1,
      scope: normalizeExternalStorybookCheckScope(command.scope) ?? inputPath("."),
      live: false,
    }, context)
  } else if (command.action === "stop") {
    result = await controller.stop({schemaVersion: 1, confirm: true}, context)
  } else {
    command satisfies never
    return 1
  }
  io.stdout(json({action: command.action, ...result}))
  return result.status === "failed" || result.status === "timeout" || result.status === "unavailable" ? 1 : 0
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
