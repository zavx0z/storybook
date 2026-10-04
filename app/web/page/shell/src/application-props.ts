import type {StorybookAppServerRequests as McpRestRequestsContract} from "@storybook-app-server/requests"
type McpRequestRecord = ReturnType<McpRestRequestsContract.Output["read"]>[number]
import type {StorybookAppWebPageShellViewpointTab} from "@storybook-app-web-page-shell/viewpoint-tab"
type ViewPointTabProps = StorybookAppWebPageShellViewpointTab.Input
import type {StorybookAppWebPageShellWorkbench} from "@storybook-app-web-page-shell/workbench"
type WorkbenchHandle = StorybookAppWebPageShellWorkbench.Output
type WorkbenchUserState = NonNullable<StorybookAppWebPageShellWorkbench.Input["userState"]>
import type {StorybookAppWebPageShellMcpWindow} from "@storybook-app-web-page-shell/mcp-window"
type McpAddressSource = NonNullable<StorybookAppWebPageShellMcpWindow.Input["addressSource"]>
type McpWindowInitialState = NonNullable<StorybookAppWebPageShellMcpWindow.Input["initialState"]>
type McpWindowState = StorybookAppWebPageShellMcpWindow.Output
import type {StorybookAppWebPageShellMinimap} from "@storybook-app-web-page-shell/minimap"
type MinimapInitialState = NonNullable<StorybookAppWebPageShellMinimap.Input["initialState"]>
type MinimapState = StorybookAppWebPageShellMinimap.Output
import type {StorybookAppWebPageShellWorkbenchCatalog} from "@storybook-app-web-page-shell-workbench/catalog"
type NavigationExpansion = NonNullable<StorybookAppWebPageShellWorkbenchCatalog.Input["navigationExpansion"]>

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
