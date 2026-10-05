import type {StorybookAppWebPageShellExecutionSettings as ExecutionSettings} from "@zavx0z/storybook-app-web-page-shell-execution-settings"
import type {StorybookAppServerRequests as McpRestRequestsContract} from "@zavx0z/storybook-app-server-requests"
import type {createLocalMcpState} from "./local-mcp-state"
import type {GlobalMcpWindowState} from "../contract/types"
type McpRequestRecord = ReturnType<McpRestRequestsContract.Output["read"]>[number]
import type {StorybookAppWebPageShellViewpointTab} from "@zavx0z/storybook-app-web-page-shell-viewpoint-tab"
type ViewPointTabProps = StorybookAppWebPageShellViewpointTab.Input
import type {StorybookAppWebPageShellWorkbench} from "@zavx0z/storybook-app-web-page-shell-workbench"
type WorkbenchHandle = StorybookAppWebPageShellWorkbench.Output
type WorkbenchUserState = NonNullable<StorybookAppWebPageShellWorkbench.Input["userState"]>
import type {StorybookAppWebPageShellMcpWindow} from "@zavx0z/storybook-app-web-page-shell-mcp-window"
type McpAddressSource = NonNullable<StorybookAppWebPageShellMcpWindow.Input["addressSource"]>
type McpWindowInitialState = NonNullable<StorybookAppWebPageShellMcpWindow.Input["initialState"]>
type McpWindowState = StorybookAppWebPageShellMcpWindow.Output
import type {StorybookAppWebPageShellMinimap} from "@zavx0z/storybook-app-web-page-shell-minimap"
type MinimapInitialState = NonNullable<StorybookAppWebPageShellMinimap.Input["initialState"]>
type MinimapState = StorybookAppWebPageShellMinimap.Output
import type {StorybookAppWebPageShellWorkbenchCatalog} from "@zavx0z/storybook-app-web-page-shell-workbench-catalog"
type NavigationExpansion = NonNullable<StorybookAppWebPageShellWorkbenchCatalog.Input["navigationExpansion"]>

export type StorybookAppProps = Readonly<{
  executionWindowState?: ExecutionSettings.Input["initialState"]
  saveExecutionWindowState?: ExecutionSettings.Input["onStateChange"]
  userState?: WorkbenchUserState | undefined
  loadMcpRequests?: ((address?: string) => Promise<readonly McpRequestRecord[]>) | undefined
  localMcpJournal?: ReturnType<typeof createLocalMcpState> | undefined
  mcpAddressSource?: McpAddressSource | undefined
  mcpWindowState?: GlobalMcpWindowState | undefined
  saveMcpWindowState?: ((state: GlobalMcpWindowState) => void) | undefined
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
