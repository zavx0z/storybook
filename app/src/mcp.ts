/**
Стабильный factory entry свежего MCP worker. App предоставляет свой публичный
контроллер только по запросу; все регистрации и протокол принадлежат `@zavx0z/storybook-app-mcp`.
*/
import mcp, {type Zavx0zStorybookAppMcp} from "@zavx0z/storybook-app-mcp"

export function createAppMcpServer(options: Zavx0zStorybookAppMcp.Input = {}) {
  return mcp.createServer({
    controllerFactory: async () => (await import("../index.ts")).default(),
    ...options,
  })
}

export default createAppMcpServer
