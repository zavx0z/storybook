/**
Стабильный factory entry свежего MCP worker. App предоставляет свой публичный
контроллер только по запросу; все регистрации и протокол принадлежат `@storybook-app/mcp`.
*/
import mcp, {type StorybookAppMcp} from "@storybook-app/mcp"

export function createAppMcpServer(options: StorybookAppMcp.Input = {}) {
  return mcp.createServer({
    controllerFactory: async () => (await import("../index.ts")).default(),
    ...options,
  })
}

export default createAppMcpServer
