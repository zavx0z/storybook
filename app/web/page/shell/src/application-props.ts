import type {Zavx0zStorybookAppServerRequests as McpRestRequestsContract} from "@zavx0z/storybook-app-server-requests"
type McpRequestRecord = ReturnType<McpRestRequestsContract.Output["read"]>[number]
import type {Zavx0zStorybookAppWebPageShellViewpointTab} from "@zavx0z/storybook-app-web-page-shell-viewpoint-tab"
type ViewPointTabProps = Zavx0zStorybookAppWebPageShellViewpointTab.Input
import type {Zavx0zStorybookAppWebPageShellWorkbench} from "@zavx0z/storybook-app-web-page-shell-workbench"
type WorkbenchHandle = Zavx0zStorybookAppWebPageShellWorkbench.Output
type WorkbenchUserState = NonNullable<Zavx0zStorybookAppWebPageShellWorkbench.Input["userState"]>
import type {Zavx0zStorybookAppWebPageShellMcpWindow} from "@zavx0z/storybook-app-web-page-shell-mcp-window"
type McpAddressSource = NonNullable<Zavx0zStorybookAppWebPageShellMcpWindow.Input["addressSource"]>
type McpWindowInitialState = NonNullable<Zavx0zStorybookAppWebPageShellMcpWindow.Input["initialState"]>
type McpWindowState = Zavx0zStorybookAppWebPageShellMcpWindow.Output
import type {Zavx0zStorybookAppWebPageShellMinimap} from "@zavx0z/storybook-app-web-page-shell-minimap"
type MinimapInitialState = NonNullable<Zavx0zStorybookAppWebPageShellMinimap.Input["initialState"]>
type MinimapState = Zavx0zStorybookAppWebPageShellMinimap.Output
import type {Zavx0zStorybookAppWebPageShellWorkbenchCatalog} from "@zavx0z/storybook-app-web-page-shell-workbench-catalog"
type NavigationExpansion = NonNullable<Zavx0zStorybookAppWebPageShellWorkbenchCatalog.Input["navigationExpansion"]>

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
