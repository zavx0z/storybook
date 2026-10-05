import type {StorybookAppServerRequests} from "@zavx0z/storybook-app-server-requests"
import type {McpAddressSource} from "./address"
import type {McpWindowInitialState} from "./state"
type McpRequestRecord = ReturnType<StorybookAppServerRequests.Output["read"]>[number]

/** Вход журнала обращений и чтения текущего адреса. */
export declare namespace StorybookAppWebPageShellMcpWindow {
  /** Полный сохраняемый снимок окна; история вызовов и ответы сюда не входят. */
  export type Output = Readonly<{
    open: boolean
    mode: "agent" | "address"
    geometry: Readonly<{x: number, y: number, width: number, height: number}>
  }>

  export type Input = Readonly<{
    id?: string | undefined
    title?: string | undefined
    /** Общий журнал содержит только вызовы агентов, без чтения текущего адреса Display. */
    journalOnly?: boolean | undefined
    open: boolean
    onClose(): void
    load?: (() => Promise<readonly McpRequestRecord[]>) | undefined
    addressSource?: McpAddressSource | undefined
    initialState?: McpWindowInitialState | undefined
    onStateChange?: ((state: Output) => void) | undefined
  }>

}
