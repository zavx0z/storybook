import WorkbenchOwner from "@web/workbench-model"
const createWorkbenchModel = WorkbenchOwner
import {WorkbenchMinimap} from "./workbench-minimap.tsx"
import ViewPointTab from "@web/viewpoint-tab"
import Workbench from "@web/workbench"
import {StorybookDisplay} from "./display-view.tsx"
import {getDocumentClipboardController} from "@zavx0z/browser/clipboard"
import type {Document as SemanticDocument} from "@zavx0z/dom"
import ClipboardMenu from "@zavx0z/ui/menu/clipboard-menu"
import {useLayoutEffect, useMemo, useState} from "@zavx0z/component"
import McpWindow from "@web/mcp-window"

import type {StorybookAppProps} from "./application-props"

/** Одна сцена с правой системой координат, осью Z вверх и расстояниями в миллиметрах. */
export function StorybookApp(props: StorybookAppProps) {
  const model = useMemo(() => createWorkbenchModel({
    document,
    navigationExpansion: props.navigationExpansion,
    userState: props.userState,
    initial: {
      title: props.title,
      "catalog.label": "Каталог",
      "preview.label": "Обзор",
      status: {lead: "Создано для ", owner: props.statusOwner, detail: " · External Storybook"},
    },
  }), [])
  useLayoutEffect(() => () => model.dispose(), [model])
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
        model={model}
        viewPointControls={props.viewPointControls}
        title={props.title}
        statusOwner={props.statusOwner}
        displayId={props.displayId}
        hudId={props.hudId}
        onReady={props.onReady}
        loadMcpRequests={props.loadMcpRequests}
        mcpAddressSource={props.mcpAddressSource}
        mcpWindowState={props.mcpWindowState}
        saveMcpWindowState={props.saveMcpWindowState}
      />
    </StorybookDisplay>
    <hud id={props.hudId}>
      <ViewPointTab controls={props.viewPointControls} />
      <WorkbenchMinimap
        model={model}
        initialState={props.minimapState}
        onStateChange={props.saveMinimapState}
        onRebuildWeb={props.onRebuildWeb}
      />
    </hud>
  </space>
}

/** Workbench и его окна принадлежат Display; изменение окон сохраняет камеру и поверхность. */
function StorybookSurface(props: StorybookAppProps & Readonly<{model: ReturnType<typeof createWorkbenchModel>}>) {
  const [mcpOpen, setMcpOpen] = useState(() => props.mcpWindowState?.open ?? false)
  const clipboard = getDocumentClipboardController(document as unknown as SemanticDocument)
  if (clipboard === null) throw new Error("Storybook requires the clipboard controller of its existing Browser Root")
  return <>
    <Workbench
      mcpOpen={mcpOpen}
      onMcpOpenChange={setMcpOpen}
      model={props.model}
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
