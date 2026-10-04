import serveMcpStdio from "@storybook-tech-mcp/stdio"
import createLazyMcpServer from "@storybook-tech-mcp/lazy"
import {fileURLToPath} from "node:url"
import {join} from "node:path"
import {tmpdir} from "node:os"

const root = fileURLToPath(new URL("../..", import.meta.url))

/** Собственный factory чата не регистрирует управляющие инструменты приложения. */
serveMcpStdio({
  diagnosticLabel: "storybook-chat-mcp",
  createServer: () => createLazyMcpServer({
    serverModule: fileURLToPath(new URL("../mcp/src/chat.ts", import.meta.url)),
    cwd: root,
    temporaryRoot: join(tmpdir(), "storybook-chat-mcp"),
    watchRoot: root,
    name: "storybook",
    version: "1.0.0",
  }),
})
