#!/usr/bin/env bun

import {fileURLToPath} from "node:url"
import {runExternalStorybookDaemon} from "../src/external/daemon.ts"

process.chdir(fileURLToPath(new URL("../", import.meta.url)))

try {
  const lease = startLease()
  await runExternalStorybookDaemon({
    declarations: process.argv.slice(2),
    port: serverPort(Bun.env.STORYBOOK_SERVER_PORT ?? "0"),
    startLease: lease,
  })
} catch (error) {
  process.stderr.write(`[storybook-daemon] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

function startLease(): Readonly<{path: string; token: string}> {
  const path = Bun.env.STORYBOOK_START_LEASE_PATH
  const token = Bun.env.STORYBOOK_START_LEASE_TOKEN
  if (path === undefined || token === undefined || path.length === 0 || token.length === 0) {
    throw new Error("Storybook startup lease path and token must be provided together")
  }
  return Object.freeze({path, token})
}

function serverPort(value: string): number {
  if (!/^(?:0|[1-9][0-9]{0,4})$/u.test(value)) throw new Error("STORYBOOK_SERVER_PORT must be 0..65535")
  const port = Number(value)
  if (port > 65_535) throw new Error("STORYBOOK_SERVER_PORT must be 0..65535")
  return port
}
