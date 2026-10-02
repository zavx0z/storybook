import type {McpRestRequests} from "@mcp-rest/requests"
import type {McpAddressSource} from "./address"
import type {McpWindowState} from "@mcp-window/state"
type McpRequestRecord = ReturnType<McpRestRequests.Output["read"]>[number]

/** Вход журнала обращений и чтения текущего адреса. */
export declare namespace WebMcpWindow {
  export type Input = Readonly<{
    open: boolean
    onClose(): void
    load?: (() => Promise<readonly McpRequestRecord[]>) | undefined
    addressSource?: McpAddressSource | undefined
    initialState?: McpWindowState.Output | undefined
    onStateChange?: ((state: McpWindowState.Output) => void) | undefined
  }>

}
