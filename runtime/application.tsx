import {ViewPointTab} from "../workbench/viewpoint-tab"
import type {ViewPointTabProps} from "../workbench/viewpoint-tab/contract/input"
import {Workbench} from "../workbench/workbench.tsx"
import type {Workbench as WorkbenchHandle} from "../workbench/contract.ts"
import {StorybookDisplay} from "./display-view.tsx"
import {getDocumentClipboardController} from "@zavx0z/browser/clipboard"
import type {Document as SemanticDocument} from "@zavx0z/dom"
import {ClipboardMenu} from "@zavx0z/ui/menus/clipboard-menu"
import {useState} from "@zavx0z/component"
import {McpWindow} from "../workbench/mcp-window"
import type {McpRequestRecord} from "@mcp/rest/requests"
import type {McpAddressSource} from "../workbench/mcp-window/src/address-request"
import type {McpWindowState} from "../workbench/mcp-window/src/state"
import type {NavigationExpansion} from "../workbench/navigation/persistence.ts"

export type StorybookAppProps = Readonly<{
  loadMcpRequests?: (() => Promise<readonly McpRequestRecord[]>) | undefined
  mcpAddressSource?: McpAddressSource | undefined
  mcpWindowState?: McpWindowState | undefined
  saveMcpWindowState?: ((state: McpWindowState) => void) | undefined
  navigationExpansion?: NavigationExpansion | undefined
  viewPointControls: ViewPointTabProps["controls"]
  title: string
  statusOwner: string
  displayId: string
  hudId: string
  onReady(workbench: WorkbenchHandle): void
}>

/** One authored scene: right-handed Z-up, all spatial distances in millimetres. */
export function StorybookApp(props: StorybookAppProps) {
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
        onReady={props.onReady}
        loadMcpRequests={props.loadMcpRequests}
        mcpAddressSource={props.mcpAddressSource}
        mcpWindowState={props.mcpWindowState}
        saveMcpWindowState={props.saveMcpWindowState}
        navigationExpansion={props.navigationExpansion}
      />
    </StorybookDisplay>
    <hud id={props.hudId}>
      <ViewPointTab controls={props.viewPointControls} />
    </hud>
  </space>
}

/** Workbench и его окна принадлежат Display; изменение окон сохраняет камеру и поверхность. */
function StorybookSurface(props: StorybookAppProps) {
  const [mcpOpen, setMcpOpen] = useState(() => props.mcpWindowState?.open ?? false)
  const clipboard = getDocumentClipboardController(document as unknown as SemanticDocument)
  if (clipboard === null) throw new Error("Storybook requires the clipboard controller of its existing Browser Root")
  return <>
    <Workbench
      onMcpOpen={() => setMcpOpen(true)}
      title={props.title}
      statusOwner={props.statusOwner}
      displayId={props.displayId}
      hudId={props.hudId}
      onReady={props.onReady}
      navigationExpansion={props.navigationExpansion}
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
