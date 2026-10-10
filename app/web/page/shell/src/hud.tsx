import type {StorybookAppWebPageShellWorkbench} from "@zavx0z/storybook-app-web-page-shell-workbench"
import ViewPointTab from "@zavx0z/storybook-app-web-page-shell-viewpoint-tab"
import ExecutionSettings from "@zavx0z/storybook-app-web-page-shell-execution-settings"
import {WorkbenchMinimap} from "./workbench-minimap"
import {StatusNotifications} from "./status-notifications-view"
import {GlobalMcpWindow} from "./global-mcp-window"
import type {StorybookAppProps} from "./application-props"

/** Окна HUD делят одну область размещения; docks и постоянное управление выше их рангов. */
export function StorybookHud(props: Readonly<{
  application: StorybookAppProps
  workbench: StorybookAppWebPageShellWorkbench.Output | null
}>) {
  const app = props.application
  return <hud id={app.hudId}>
    <div
      data-storybook-hud-windows=""
      style={css`
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        pointer-events: none;
        z-index: 0;

        & [data-hud-window-dock] {
          z-index: 2147483647;
        }
      `}
    >
      <ExecutionSettings
        directories={app.directorySettingsClient}
        initialState={app.executionWindowState}
        onStateChange={app.saveExecutionWindowState}
      />
      <GlobalMcpWindow
        loadMcpRequests={app.loadMcpRequests}
        mcpWindowState={app.mcpWindowState}
        saveMcpWindowState={app.saveMcpWindowState}
      />
      {props.workbench === null ? null : <WorkbenchMinimap
        workbench={props.workbench}
        initialState={app.minimapState}
        onStateChange={app.saveMinimapState}
        onRebuildWeb={app.onRebuildWeb}
      />}
    </div>
    <div
      data-storybook-hud-controls=""
      style={css`
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1;
      `}
    >
      <ViewPointTab
        controls={app.viewPointControls}
        followEnvironment={app.followEnvironment}
      />
    </div>
    {app.statusNotifications === undefined ? null : <StatusNotifications source={app.statusNotifications} />}
  </hud>
}
