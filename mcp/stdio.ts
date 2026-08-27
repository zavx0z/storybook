#!/usr/bin/env bun

import {McpServer} from "@modelcontextprotocol/server"
import {serveStdio} from "@modelcontextprotocol/server/stdio"

const handle = serveStdio(
  () => new McpServer(
    {name: "storybook", version: "0.0.0"},
    {instructions: "Empty experimental Storybook MCP. No tools, resources, or prompts are registered yet."},
  ),
  {onerror: (error) => process.stderr.write(`[storybook-mcp] ${error.message}\n`)},
)

process.stderr.write("[storybook-mcp] ready\n")

process.once("SIGINT", () => close(130))
process.once("SIGTERM", () => close(143))

function close(code: number): void {
  void handle.close().finally(() => process.exit(code))
}
