import {Workbench} from "../workbench/workbench.tsx"
import type {Workbench as WorkbenchHandle} from "../workbench/contract.ts"
import {StorybookDisplay} from "./display-view.tsx"
import {getDocumentClipboardController} from "@zavx0z/browser/clipboard"
import type {Document as SemanticDocument} from "@zavx0z/dom"
import {ClipboardMenu} from "@zavx0z/ui/menus/clipboard-menu"
import {useState} from "@zavx0z/component"
import {McpWindow} from "../workbench/mcp-window"
import type {McpRequestRecord} from "@mcp/rest/requests"

export type StorybookAppProps = Readonly<{
  loadMcpRequests?: (() => Promise<readonly McpRequestRecord[]>) | undefined
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
    <StorybookDisplay id={props.displayId} />
    <StorybookHUD
      title={props.title}
      statusOwner={props.statusOwner}
      displayId={props.displayId}
      hudId={props.hudId}
      onReady={props.onReady}
      loadMcpRequests={props.loadMcpRequests}
    />
  </space>
}

/** Состояние окон HUD не обновляет начальные параметры камеры и дисплея. */
function StorybookHUD(props: StorybookAppProps) {
  const [mcpOpen, setMcpOpen] = useState(false)
  const clipboard = getDocumentClipboardController(document as unknown as SemanticDocument)
  if (clipboard === null) throw new Error("Storybook requires the clipboard controller of its existing Browser Root")
  return <hud id={props.hudId}>
      <Workbench
        onMcpOpen={() => setMcpOpen(true)}
        title={props.title}
        statusOwner={props.statusOwner}
        displayId={props.displayId}
        onReady={props.onReady}
      />
      <ClipboardMenu controller={clipboard} />
      <McpWindow
        open={mcpOpen}
        onClose={() => setMcpOpen(false)}
        load={props.loadMcpRequests}
      />
    </hud>
}
