import type {createRoot as createBrowserRoot, IntegrationRoot} from "@zavx0z/immersive-browser/integration"
import type {StorybookAppWebPageShellWorkbench} from "@zavx0z/storybook-app-web-page-shell-workbench"
import type {StorybookAppWebPageShellMinimap} from "@zavx0z/storybook-app-web-page-shell-minimap"
import type {StorybookAppWebPageShellMcpWindow} from "@zavx0z/storybook-app-web-page-shell-mcp-window"
import type {SavedState} from "./viewpoint-state"

type WorkbenchUserState = NonNullable<StorybookAppWebPageShellWorkbench.Input["userState"]>
type MinimapState = NonNullable<StorybookAppWebPageShellMinimap.Input["initialState"]>
type McpWindowState = NonNullable<StorybookAppWebPageShellMcpWindow.Input["initialState"]>

export type ExternalStorybookRootFactory = typeof createBrowserRoot

export type ExternalStorybookNativeKey = Readonly<{
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}>

/** Снимок настроек именно этой вкладки; другой localStorage writer не меняет её HMR-состояние. */
export type StorybookShellUserState = Readonly<{
  workbench: WorkbenchUserState
  minimap: MinimapState | undefined
  mcpWindow: McpWindowState | undefined
  viewPoint: SavedState
  collapsedNavigation: readonly string[] | undefined
}>

/** Передача существующего Browser root новой реализации App в той же платформе. */
export type StorybookRetainedRoot = Readonly<{
  application: IntegrationRoot
  diagnostics: {publish(value: unknown): void}
}>
