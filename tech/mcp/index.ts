/**
Собирает технические возможности MCP: stdio-соединение, изолированное lazy-исполнение
и уведомления о ходе запроса. Предметные инструменты подключает приложение.

@packageDocumentation
*/
export {default as serveMcpStdio} from "@mcp/stdio"
export type {McpStdio} from "@mcp/stdio"
export {default as createRequestProgress} from "@mcp/progress"
export type {McpProgress} from "@mcp/progress"

export {default as createLazyMcpServer} from "@mcp/lazy"
export type {McpLazy} from "@mcp/lazy"
