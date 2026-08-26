#!/usr/bin/env bun

import {
  clearStorybookStopRequest,
  inspectStorybookPackage,
  launchStorybookPackage,
  resolveStorybookPackage,
  stopStorybookPackage,
  storybookExitWasRequested,
} from "@zavx0z/storybook/launcher"

const {action, packageName, repositoryRoot} = parseArguments(Bun.argv.slice(2))
const packageIdentity = await resolveStorybookPackage(packageName, {
  ...(repositoryRoot === null ? {} : {repositoryRoot}),
})

if (action === "resolve") {
  output({action, package: packageIdentity})
  process.exit(0)
}

if (action === "build" || action === "check") {
  const child = Bun.spawn(["bun", "run", action], {
    cwd: packageIdentity.directory,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  process.exit(await child.exited)
}

if (action === "status") {
  const current = await inspectStorybookPackage(packageIdentity)
  output({action, ...current})
  if (current.status === "stale") process.exitCode = 1
  process.exit()
}

if (action === "stop") {
  const stopped = await stopStorybookPackage(packageIdentity, "stop")
  output({action, ...stopped})
  process.exit(0)
}

if (action === "restart") await stopStorybookPackage(packageIdentity, "restart")

const launched = await launchStorybookPackage(packageIdentity, {
  ensure: action === "ensure",
})
output({action, outcome: launched.outcome, package: launched.package, runtime: launched.runtime})
if (launched.child === null) process.exit(0)

const exitCode = await launched.child.exited
const requested = storybookExitWasRequested(packageIdentity, launched.runtime)
if (requested) clearStorybookStopRequest(packageIdentity)
if (requested) process.exit(0)
process.exit(exitCode === 0 ? 1 : exitCode)

type Action = "resolve" | "status" | "start" | "ensure" | "restart" | "stop" | "build" | "check"

function parseArguments(args: readonly string[]): Readonly<{
  action: Action
  packageName: string
  repositoryRoot: string | null
}> {
  const [actionValue, packageName, ...rest] = args
  if (!isAction(actionValue) || packageName === undefined) usage()
  let repositoryRoot: string | null = null
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (argument !== "--root") usage()
    const value = rest[index + 1]
    if (value === undefined || repositoryRoot !== null) usage()
    repositoryRoot = value
    index += 1
  }
  return Object.freeze({action: actionValue, packageName, repositoryRoot})
}

function isAction(value: string | undefined): value is Action {
  return value !== undefined && ["resolve", "status", "start", "ensure", "restart", "stop", "build", "check"].includes(value)
}

function usage(): never {
  throw new Error("Usage: storybook <resolve|status|start|ensure|restart|stop|build|check> <@scope/storybook> [--root <repository>]")
}

function output(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}
