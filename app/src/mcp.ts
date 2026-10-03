/**
Стабильный factory entry свежего MCP worker. App предоставляет свой публичный
контроллер только по запросу; все регистрации и протокол принадлежат `@app/mcp`.
*/
import mcp, {type AppMcp} from "@app/mcp"

export function createAppMcpServer(options: AppMcp.Input = {}) {
  return mcp.createServer({
    controllerFactory: async () => (await import("../index.ts")).default(),
    ...options,
  })
}

export default createAppMcpServer
