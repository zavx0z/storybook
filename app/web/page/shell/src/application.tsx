import {SpatialTree} from "@zavx0z/immersive-nodes/spatial/tree"
import {WorkbenchMinimap} from "./workbench-minimap.tsx"
import ViewPointTab from "@zavx0z/storybook-app-web-page-shell-viewpoint-tab"
import Workbench, {type StorybookAppWebPageShellWorkbench} from "@zavx0z/storybook-app-web-page-shell-workbench"
import {StorybookDisplay} from "./display-view.tsx"
import {getDocumentClipboardController} from "@zavx0z/immersive-browser/clipboard"
import type {Document as SemanticDocument} from "@zavx0z/immersive-dom"
import {ClipboardMenu} from "@zavx0z/immersive-ui-component"
import {useState} from "@zavx0z/immersive-component"
import {StatusNotifications} from "./status-notifications-view"
import {GlobalMcpWindow} from "./global-mcp-window"
import ExecutionSettings from "@zavx0z/storybook-app-web-page-shell-execution-settings"

import type {StorybookAppProps} from "./application-props"

/** Одна сцена с правой системой координат, осью Z вверх и расстояниями в миллиметрах. */
export function StorybookApp(props: StorybookAppProps) {
  const [workbench, setWorkbench] = useState<StorybookAppWebPageShellWorkbench.Output | null>(null)
  return <space>
    <viewpoint
      x={0}
      y={-1000}
      z={0}
      targetX={0}
      targetY={0}
      targetZ={0}
      far={2000}
    />
    <xr-light
      name="Освещение пространства"
      kind="directional"
      color="#ffffff"
      intensity={1}
      x={-100000}
      y={-100000}
      z={200000}
    />
    <StorybookDisplay id={props.displayId}>
      <StorybookSurface
        viewPointControls={props.viewPointControls}
        followEnvironment={props.followEnvironment}
        title={props.title}
        statusOwner={props.statusOwner}
        displayId={props.displayId}
        hudId={props.hudId}
        onReady={value => {
          setWorkbench(value)
          props.onReady(value)
        }}
        userState={props.userState}
        navigationExpansion={props.navigationExpansion}
      />
    </StorybookDisplay>
    {props.subjectGraphState === undefined ? null : <SpatialTree source={props.subjectGraphState} />}
    <hud id={props.hudId}>
      <ViewPointTab
        controls={props.viewPointControls}
        followEnvironment={props.followEnvironment}
      />
      <ExecutionSettings
        directories={props.directorySettingsClient}
        initialState={props.executionWindowState}
        onStateChange={props.saveExecutionWindowState}
      />
      <GlobalMcpWindow
        loadMcpRequests={props.loadMcpRequests}
        mcpWindowState={props.mcpWindowState}
        saveMcpWindowState={props.saveMcpWindowState}
      />
      {workbench === null ? null : <WorkbenchMinimap
        workbench={workbench}
        initialState={props.minimapState}
        onStateChange={props.saveMinimapState}
        onRebuildWeb={props.onRebuildWeb}
      />}
      {props.statusNotifications === undefined ? null : <StatusNotifications source={props.statusNotifications} />}
    </hud>
  </space>
}

/** Workbench и его окна принадлежат Display; изменение окон сохраняет ViewPoint и поверхность. */
export function StorybookSurface(props: StorybookAppProps) {
  const clipboard = getDocumentClipboardController(document as unknown as SemanticDocument)
  if (clipboard === null) throw new Error("Storybook requires the clipboard controller of its existing Browser Root")
  return <>
    <Workbench
      initial={{
        title: props.title,
        "catalog.label": "Каталог",
        "preview.label": "Обзор",
        status: {lead: "Создано для ", owner: props.statusOwner, detail: ""},
      }}
      userState={props.userState}
      navigationExpansion={props.navigationExpansion}
      displayId={props.displayId}
      hudId={props.hudId}
      onReady={props.onReady}
    />
    <ClipboardMenu controller={clipboard} />
  </>
}
