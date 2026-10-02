import type {createRoot as createBrowserRoot, IntegrationRoot} from "@zavx0z/browser/integration"
import type {WebWorkbenchModel} from "@web/workbench-model"
import type {WebMinimap} from "@web/minimap"
import type {WebMcpWindow} from "@web/mcp-window"
import type {SavedState} from "./viewpoint-state"

type WorkbenchUserState = ReturnType<ReturnType<WebWorkbenchModel.Output["bind"]>["controller"]["captureUserState"]>
type MinimapState = NonNullable<WebMinimap.Input["initialState"]>
type McpWindowState = NonNullable<WebMcpWindow.Input["initialState"]>

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
  minimap: MinimapState
  mcpWindow: McpWindowState
  viewPoint: SavedState
  collapsedNavigation: readonly string[]
}>

/** Передача существующего Browser root новой реализации App в той же платформе. */
export type StorybookRetainedRoot = Readonly<{
  application: IntegrationRoot
  diagnostics: {publish(value: unknown): void}
}>
