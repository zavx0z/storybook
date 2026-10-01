/**
Собирает самостоятельные технические возможности MCP: stdio-соединение
и уведомления о ходе одного запроса. Предметные инструменты подключает приложение.

@packageDocumentation
*/
export {default as serveMcpStdio} from "@mcp/stdio"
export type {McpStdio} from "@mcp/stdio"
export {default as createRequestProgress} from "@mcp/progress"
export type {McpProgress} from "@mcp/progress"
