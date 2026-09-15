import {RequestList} from "../src/request-list"
import type {McpRequestRecord} from "@mcp/rest/requests"

/** Минимальное воспроизведение GPU-отрисовки содержимого журнала без иконок оболочки Window. */
export function JournalGpuContent(props: Readonly<{entries: readonly McpRequestRecord[]}>) {
  return <div style={css`
    width: 620px;
    height: 400px;
    overflow: hidden;
  `}>
    <RequestList entries={props.entries} error="" />
  </div>
}
