import type {ContractSchema, McpContentSources} from "./types"

/** Подготовленные источники владельца и доступные агенту контракты с примерами. */
export declare namespace Zavx0zStorybookPackageMcpContent {
  type Input = McpContentSources
  type Output = Readonly<{
    input?: ContractSchema
    output?: ContractSchema
    slots?: ContractSchema
    scenarios?: readonly string[]
  }>
}
