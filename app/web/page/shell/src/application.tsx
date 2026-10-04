import {WorkbenchMinimap} from "./workbench-minimap.tsx"
import ViewPointTab from "@zavx0z/storybook-app-web-page-shell-viewpoint-tab"
import Workbench, {type StorybookAppWebPageShellWorkbench} from "@zavx0z/storybook-app-web-page-shell-workbench"
import {StorybookDisplay} from "./display-view.tsx"
import {getDocumentClipboardController} from "@zavx0z/immersive-browser/clipboard"
import type {Document as SemanticDocument} from "@zavx0z/immersive-dom"
import {ClipboardMenu} from "@zavx0z/immersive-ui-component"
import {useCallback, useMemo, useState, useSyncExternalStore} from "@zavx0z/immersive-component"
import McpWindow from "@zavx0z/storybook-app-web-page-shell-mcp-window"
import {GlobalMcpWindow} from "./global-mcp-window"

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
        localMcpJournal={props.localMcpJournal}
      />
    </StorybookDisplay>
    <hud id={props.hudId}>
      <ViewPointTab controls={props.viewPointControls} />
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
    </hud>
  </space>
}

/** Workbench и его окна принадлежат Display; изменение окон сохраняет камеру и поверхность. */
function StorybookSurface(props: StorybookAppProps) {
  const local = useSyncExternalStore(props.localMcpJournal?.subscribe ?? noSubscription,
    props.localMcpJournal?.getSnapshot ?? emptySnapshot)
  const mcpOpen = local.state?.minimized !== true && local.state?.open === true
  const setMcpOpen = useCallback((open: boolean) => props.localMcpJournal?.setOpen(open), [props.localMcpJournal])
  const load = useCallback(() => props.loadMcpRequests?.(local.address) ?? Promise.resolve([]), [props.loadMcpRequests, local.address])
  const save = useCallback((state: Parameters<NonNullable<StorybookAppProps["localMcpJournal"]>["save"]>[1]) => {
    props.localMcpJournal?.save(local.address, state)
  }, [props.localMcpJournal, local.address])
  const addressSource = useMemo(() => props.mcpAddressSource === undefined ? undefined : {
    readAddress: () => local.address,
    request: props.mcpAddressSource.request,
  }, [props.mcpAddressSource, local.address])
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
      key={local.address}
      id={`${props.displayId}-mcp`}
      title="Журнал агента"
      open={mcpOpen}
      onClose={() => setMcpOpen(false)}
      load={load}
      addressSource={addressSource}
      initialState={local.state}
      onStateChange={save}
    />
  </>
}

const noSubscription = () => () => {}
const emptyLocal = {address: "/", state: undefined}
const emptySnapshot = () => emptyLocal
