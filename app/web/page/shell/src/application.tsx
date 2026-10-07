import type {DisplayElement} from "@zavx0z/immersive-dom/display"
import {SpatialGraph, spatialContentBounds, type SpatialGraphNode} from "@zavx0z/immersive-nodes/spatial"
import type {SubjectGraphPresentation} from "./subject-graph-state"
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
import ExecutionSettings from "@zavx0z/storybook-app-web-page-shell-execution-settings"
import {DirectorySettingsWindow} from "./directory-settings-window"

import type {StorybookAppProps} from "./application-props"

/** Одна сцена с правой системой координат, осью Z вверх и расстояниями в миллиметрах. */
export function StorybookApp(props: StorybookAppProps) {
  const graph = useSyncExternalStore(props.subjectGraphState?.subscribe ?? noSubscription,
    props.subjectGraphState?.getSnapshot ?? emptyGraphSnapshot)
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
    {graph === null ? null : <SpatialGraph
      bounds={graph.bounds}
      nodes={graph.nodes}
      links={graph.links}
      selectedId={graph.selectedId}
      millimetersPerPixel={graph.millimetersPerPixel}
      contentSurface={graph.contentSurface}
      onSelect={graph.onSelect}
    />}
    {graph === null ? null : <SubjectDisplays graph={graph} />}
    <hud id={props.hudId}>
      <ViewPointTab controls={props.viewPointControls} />
      {props.directorySettingsClient === undefined ? null : <DirectorySettingsWindow
        client={props.directorySettingsClient}
      />}
      <ExecutionSettings initialState={props.executionWindowState} onStateChange={props.saveExecutionWindowState} />
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

/** Составляет прежние Display приложения как непосредственных соседей в Space. */
function SubjectDisplays(props: Readonly<{graph: SubjectGraphPresentation}>) {
  return <>
    {props.graph.nodes.map(node => <SubjectDisplay
      key={node.id}
      node={node}
      graph={props.graph}
    />)}
  </>
}

/** Сохраняет самостоятельный Display и ref при выборе и изменении геометрии графа. */
function SubjectDisplay(props: Readonly<{node: SpatialGraphNode; graph: SubjectGraphPresentation}>) {
  const ready = useMemo(() => (display: DisplayElement | null) => {
    props.graph.onContentHost(props.node.id, display)
  }, [props.node.id, props.graph.onContentHost])
  const content = props.graph.contentById.get(props.node.id)
  return <StorybookDisplay
    id={`spatial-content-${encodeURIComponent(props.node.id)}`}
    surface={spatialContentBounds(props.node.rect, props.graph)}
    viewport={props.graph.contentViewport}
    onReady={ready}
  >
    {content === undefined ? null : <StorybookSurface
      viewPointControls={content.viewPointControls}
      title={content.title}
      statusOwner={content.statusOwner}
      displayId={content.displayId}
      hudId={content.hudId}
      onReady={content.onReady}
      userState={content.userState}
      navigationExpansion={content.navigationExpansion}
      loadMcpRequests={content.loadMcpRequests}
      mcpAddressSource={content.mcpAddressSource}
      localMcpJournal={content.localMcpJournal}
    />}
  </StorybookDisplay>
}

/** Workbench и его окна принадлежат Display; изменение окон сохраняет камеру и поверхность. */
export function StorybookSurface(props: StorybookAppProps) {
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

const emptyGraphSnapshot = () => null
