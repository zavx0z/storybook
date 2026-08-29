#!/usr/bin/env bun

import {serveStdio} from "@modelcontextprotocol/server/stdio"
import {createStorybookMcpServer} from "./server.ts"

const handle = serveStdio(
  () => createStorybookMcpServer(),
  {onerror: (error) => diagnostic(error.message)},
)

diagnostic("ready")

process.once("SIGINT", () => close(130))
process.once("SIGTERM", () => close(143))

function close(code: number): void {
  void handle.close().finally(() => process.exit(code))
}

function diagnostic(value: string): void {
  const bounded = String(value).replace(/[\r\n]+/gu, " ").slice(0, 4_096)
  process.stderr.write(`[storybook-mcp] ${bounded}\n`)
}
