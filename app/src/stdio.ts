#!/usr/bin/env bun

import serveMcpStdio from "@storybook-tech-mcp/stdio"
import createLazyMcpServer from "@storybook-tech-mcp/lazy"
import {fileURLToPath} from "node:url"
import {join} from "node:path"
import {tmpdir} from "node:os"

const root = fileURLToPath(new URL("../..", import.meta.url))

/** Транспорт удерживает соединение; текущие регистрации и исполнение загружает worker. */
serveMcpStdio({
  createServer: () => createLazyMcpServer({
    serverModule: fileURLToPath(new URL("./mcp.ts", import.meta.url)),
    cwd: root,
    temporaryRoot: join(tmpdir(), "storybook-mcp"),
    watchRoot: root,
    name: "storybook",
    version: "1.0.0",
  }),
  diagnosticLabel: "storybook-mcp",
})
