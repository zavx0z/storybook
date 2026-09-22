import {Button} from "@zavx0z/ui/buttons/button"
import type {McpRequestRecord} from "@mcp/rest/requests"
import {RequestList} from "./request-list"
import {AddressRequest, type McpAddressSource} from "./address-request"

/** Сохраняет выбор команды агента при переключении на чтение текущего адреса. */
export function McpContent(props: Readonly<{
  open: boolean
  mode: "agent" | "address"
  onMode(mode: "agent" | "address"): void
  entries: readonly McpRequestRecord[]
  error: string
  addressSource?: McpAddressSource | undefined
}>) {
  return <div style={css`
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    height: 100%;
  `}>
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
