import type {McpRestRequests as McpRestRequestsContract} from "@mcp-rest/requests"
type McpRequestRecord = ReturnType<McpRestRequestsContract.Output["read"]>[number]
import type {WebViewpointTab} from "@web/viewpoint-tab"
type ViewPointTabProps = WebViewpointTab.Input
import type {WebWorkbenchModel} from "@web/workbench-model"
type WorkbenchHandle = ReturnType<WebWorkbenchModel.Output["bind"]>
type WorkbenchUserState = ReturnType<ReturnType<WebWorkbenchModel.Output["bind"]>["controller"]["captureUserState"]>
import type {WebMcpWindow} from "@web/mcp-window"
type McpAddressSource = NonNullable<WebMcpWindow.Input["addressSource"]>
type McpWindowState = NonNullable<WebMcpWindow.Input["initialState"]>
import type {WebMinimap} from "@web/minimap"
type MinimapState = NonNullable<WebMinimap.Input["initialState"]>
import type {WebCatalog} from "@web/catalog"
type NavigationExpansion = NonNullable<WebCatalog.Input["navigationExpansion"]>

export type StorybookAppProps = Readonly<{
  userState?: WorkbenchUserState | undefined
  loadMcpRequests?: (() => Promise<readonly McpRequestRecord[]>) | undefined
  mcpAddressSource?: McpAddressSource | undefined
  mcpWindowState?: McpWindowState | undefined
  saveMcpWindowState?: ((state: McpWindowState) => void) | undefined
  navigationExpansion?: NavigationExpansion | undefined
  minimapState?: MinimapState | undefined
  saveMinimapState?: ((state: MinimapState) => void) | undefined
  onRebuildWeb?: (() => Promise<void>) | undefined
  viewPointControls: ViewPointTabProps["controls"]
  title: string
  statusOwner: string
  displayId: string
  hudId: string
  onReady(workbench: WorkbenchHandle): void
}>
