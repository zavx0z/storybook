import type {McpRestRequests} from "@mcp-rest/requests"
import type {McpAddressSource} from "./address"
import type {McpWindowInitialState} from "./state"
type McpRequestRecord = ReturnType<McpRestRequests.Output["read"]>[number]

/** Вход журнала обращений и чтения текущего адреса. */
export declare namespace WebMcpWindow {
  /** Полный сохраняемый снимок окна; история и ответы MCP сюда не входят. */
  export type Output = Readonly<{
    open: boolean
    mode: "agent" | "address"
    geometry: Readonly<{x: number, y: number, width: number, height: number}>
  }>

  export type Input = Readonly<{
    open: boolean
    onClose(): void
    load?: (() => Promise<readonly McpRequestRecord[]>) | undefined
    addressSource?: McpAddressSource | undefined
    initialState?: McpWindowInitialState | undefined
    onStateChange?: ((state: Output) => void) | undefined
  }>

}
