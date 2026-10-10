import type {StorybookAppWebPageShellExecutionSettings as ExecutionSettings} from "@zavx0z/storybook-app-web-page-shell-execution-settings"
import type {createRoot as createBrowserRoot, IntegrationRoot} from "@zavx0z/immersive/XReact/browser/integration"
import type {StorybookAppWebPageShellWorkbench} from "@zavx0z/storybook-app-web-page-shell-workbench"
import type {StorybookAppWebPageShellMinimap} from "@zavx0z/storybook-app-web-page-shell-minimap"
import type {StorybookAppWebPageShellMcpWindow} from "@zavx0z/storybook-app-web-page-shell-mcp-window"
import type {SavedState} from "./viewpoint-state"

type WorkbenchUserState = NonNullable<StorybookAppWebPageShellWorkbench.Input["userState"]>
type MinimapState = NonNullable<StorybookAppWebPageShellMinimap.Input["initialState"]>
type McpWindowState = NonNullable<StorybookAppWebPageShellMcpWindow.Input["initialState"]>
export type LocalMcpWindowState = Readonly<{address: string, state: McpWindowState}>
export type GlobalMcpWindowState = McpWindowState & Readonly<{tab?: Readonly<{edge: "left" | "right" | "top" | "bottom", offset: number}>}>

export type ExternalStorybookRootFactory = typeof createBrowserRoot

/** Предмет пространства и его родитель в опубликованной иерархии. */
export type StorybookShellSubject = Readonly<{
  id: string
  parentId?: string
  label: string
  /** Самостоятельная поверхность Repo; внутренние пакеты разделяют этот Display. */
  surfaceId?: string
}>

export type ExternalStorybookNativeKey = Readonly<{
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}>

/** Снимок настроек именно этой вкладки; другой localStorage writer не меняет её HMR-состояние. */
export type StorybookShellUserState = Readonly<{
  followEnvironment?: boolean
  /** Совместимость сохранённого обзора с устройством пространства. */
  spatialLayout?: "repo-frame/1" | "prism-tree/1" | "prism-tree/2" | "prism-tree/3"
  workbench: WorkbenchUserState
  minimap: MinimapState | undefined
  executionWindow?: ExecutionSettings.Input["initialState"]
  mcpWindow: GlobalMcpWindowState | undefined
  localMcpWindows?: readonly LocalMcpWindowState[]
  viewPoint: SavedState
  collapsedNavigation: readonly string[] | undefined
}>

/** Передача существующего Browser root новой реализации App в той же платформе. */
export type StorybookRetainedRoot = Readonly<{
  application: IntegrationRoot
  diagnostics: {publish(value: unknown): void}
}>
