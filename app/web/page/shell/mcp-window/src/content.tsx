import {type StorybookAppServerRequests as McpRestRequestsContract} from "@zavx0z/storybook-app-server-requests"
type McpRequestRecord = ReturnType<McpRestRequestsContract.Output["read"]>[number]
import {Button} from "@zavx0z/immersive/ui"
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
  journalOnly?: boolean | undefined
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
      aria-label="Разделы среды"
      hidden={props.journalOnly === true}
      style={css`
        display: flex;
        flex-wrap: wrap;
        flex-shrink: 0;
        gap: 6px;
        padding: 6px;

        &[hidden] {
          display: none;
        }
      `}
    >
      <Button
        label="Вызовы"
        size="small"
        disabled={props.mode === "agent"}
        onClick={() => props.onMode("agent")}
      />
      <Button
        label="Контекст"
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
        active={props.open && props.mode === "agent"}
      />
    </div>
    {props.journalOnly ? null : <AddressRequest
      active={props.open && props.mode === "address"}
      source={props.addressSource}
    />}
  </div>
}
