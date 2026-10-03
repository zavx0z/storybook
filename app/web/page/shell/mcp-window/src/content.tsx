import {type McpRestRequests as McpRestRequestsContract} from "@mcp-rest/requests"
type McpRequestRecord = ReturnType<McpRestRequestsContract.Output["read"]>[number]
import Button from "@zavx0z/ui/button/button"
import {RequestList} from "./request-list"
import {AddressRequest} from "./address-request"
import type {McpAddressSource} from "../contract/address"

/** Сохраняет выбор команды агента при переключении на чтение текущего адреса. */
export function McpContent(props: Readonly<{
  open: boolean
  mode: "agent" | "address"
  onMode(mode: "agent" | "address"): void
  entries: readonly McpRequestRecord[]
  error: string
  addressSource?: McpAddressSource | undefined
}>) {
  return <div
    style={css`
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      height: 100%;
    `}
  >
    <div
      role="toolbar"
      aria-label="Режим журнала MCP"
      style={css`
        display: flex;
        flex-wrap: wrap;
        flex-shrink: 0;
        gap: 6px;
        padding: 6px;
      `}
    >
      <Button
        label="Вызовы агента"
        size="small"
        disabled={props.mode === "agent"}
        onClick={() => props.onMode("agent")}
      />
      <Button
        label="Текущий адрес → MCP"
        size="small"
        disabled={props.mode === "address"}
        onClick={() => props.onMode("address")}
      />
    </div>
    <div
      hidden={props.mode !== "agent"}
      style={css`
        display: flex;
        flex: 1;
        min-height: 0;

        &[hidden] {
          display: none;
        }
      `}
    >
      <RequestList
        entries={props.entries}
        error={props.error}
      />
    </div>
    <AddressRequest
      active={props.open && props.mode === "address"}
      source={props.addressSource}
    />
  </div>
}
