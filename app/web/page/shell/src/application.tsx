import {WorkbenchMinimap} from "./workbench-minimap.tsx"
import ViewPointTab from "@web/viewpoint-tab"
import Workbench, {type WebWorkbench} from "@web/workbench"
import {StorybookDisplay} from "./display-view.tsx"
import {getDocumentClipboardController} from "@zavx0z/browser/clipboard"
import type {Document as SemanticDocument} from "@zavx0z/dom"
import ClipboardMenu from "@zavx0z/ui/menu/clipboard-menu"
import {useState} from "@zavx0z/component"
import McpWindow from "@web/mcp-window"

import type {StorybookAppProps} from "./application-props"

/** Одна сцена с правой системой координат, осью Z вверх и расстояниями в миллиметрах. */
export function StorybookApp(props: StorybookAppProps) {
  const [workbench, setWorkbench] = useState<WebWorkbench.Output | null>(null)
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
    <StorybookDisplay id={props.displayId}>
      <StorybookSurface
        viewPointControls={props.viewPointControls}
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
        loadMcpRequests={props.loadMcpRequests}
        mcpAddressSource={props.mcpAddressSource}
        mcpWindowState={props.mcpWindowState}
        saveMcpWindowState={props.saveMcpWindowState}
      />
    </StorybookDisplay>
    <hud id={props.hudId}>
      <ViewPointTab controls={props.viewPointControls} />
      {workbench === null ? null : <WorkbenchMinimap
        workbench={workbench}
        initialState={props.minimapState}
        onStateChange={props.saveMinimapState}
        onRebuildWeb={props.onRebuildWeb}
      />}
    </hud>
  </space>
}

/** Workbench и его окна принадлежат Display; изменение окон сохраняет камеру и поверхность. */
function StorybookSurface(props: StorybookAppProps) {
  const [mcpOpen, setMcpOpen] = useState(() => props.mcpWindowState?.minimized !== true && props.mcpWindowState?.open === true)
  const clipboard = getDocumentClipboardController(document as unknown as SemanticDocument)
  if (clipboard === null) throw new Error("Storybook requires the clipboard controller of its existing Browser Root")
  return <>
    <Workbench
      mcpOpen={mcpOpen}
      onMcpOpenChange={setMcpOpen}
      initial={{
        title: props.title,
        "catalog.label": "Каталог",
        "preview.label": "Обзор",
        status: {lead: "Создано для ", owner: props.statusOwner, detail: " · External Storybook"},
      }}
      userState={props.userState}
      navigationExpansion={props.navigationExpansion}
      displayId={props.displayId}
      hudId={props.hudId}
      onReady={props.onReady}
    />
    <ClipboardMenu controller={clipboard} />
    <McpWindow
      open={mcpOpen}
      onClose={() => setMcpOpen(false)}
      load={props.loadMcpRequests}
      addressSource={props.mcpAddressSource}
      initialState={props.mcpWindowState}
      onStateChange={props.saveMcpWindowState}
    />
  </>
}
