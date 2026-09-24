import type {ReadMcpChildrenOutput} from "@mcp/children"

/** Корневой навигационный ответ Children с собственным названием, без адреса проекта. */
export type ReadMcpRootOutput = Omit<ReadMcpChildrenOutput, "path">
