import type {McpRestRequests as McpRestRequestsContract} from "@mcp-rest/requests"
type McpRequestRecord = ReturnType<McpRestRequestsContract.Output["read"]>[number]
import type {WebViewpointTab} from "@web/viewpoint-tab"
type ViewPointTabProps = WebViewpointTab.Input
import type {WebWorkbench} from "@web/workbench"
type WorkbenchHandle = WebWorkbench.Output
type WorkbenchUserState = NonNullable<WebWorkbench.Input["userState"]>
import type {WebMcpWindow} from "@web/mcp-window"
type McpAddressSource = NonNullable<WebMcpWindow.Input["addressSource"]>
type McpWindowInitialState = NonNullable<WebMcpWindow.Input["initialState"]>
type McpWindowState = WebMcpWindow.Output
import type {WebMinimap} from "@web/minimap"
type MinimapInitialState = NonNullable<WebMinimap.Input["initialState"]>
type MinimapState = WebMinimap.Output
import type {WebCatalog} from "@web/catalog"
type NavigationExpansion = NonNullable<WebCatalog.Input["navigationExpansion"]>

export type StorybookAppProps = Readonly<{
  userState?: WorkbenchUserState | undefined
  loadMcpRequests?: (() => Promise<readonly McpRequestRecord[]>) | undefined
  mcpAddressSource?: McpAddressSource | undefined
  mcpWindowState?: McpWindowInitialState | undefined
  saveMcpWindowState?: ((state: McpWindowState) => void) | undefined
  navigationExpansion?: NavigationExpansion | undefined
  minimapState?: MinimapInitialState | undefined
  saveMinimapState?: ((state: MinimapState) => void) | undefined
  onRebuildWeb?: (() => Promise<void>) | undefined
  viewPointControls: ViewPointTabProps["controls"]
  title: string
  statusOwner: string
  displayId: string
  hudId: string
  onReady(workbench: WorkbenchHandle): void
}>
