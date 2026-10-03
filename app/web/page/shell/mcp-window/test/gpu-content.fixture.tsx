import {type McpRestRequests as McpRestRequestsContract} from "@mcp-rest/requests"
type McpRequestRecord = ReturnType<McpRestRequestsContract.Output["read"]>[number]
import {RequestList} from "../src/request-list"

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
