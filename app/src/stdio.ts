#!/usr/bin/env bun

import serveMcpStdio from "@mcp/stdio"
import {createAppMcpServer} from "./mcp.ts"

serveMcpStdio({
  createServer: () => createAppMcpServer(),
  diagnosticLabel: "storybook-mcp",
})
