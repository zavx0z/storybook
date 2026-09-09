import {Workbench} from "../workbench/workbench.tsx"
import type {Workbench as WorkbenchHandle} from "../workbench/contract.ts"
import {StorybookDisplay} from "./display-view.tsx"
import {getDocumentClipboardController} from "@zavx0z/browser/clipboard"
import type {Document as SemanticDocument} from "@zavx0z/dom"
import {ClipboardMenu} from "@zavx0z/ui/menus/clipboard-menu"

export type StorybookAppProps = Readonly<{
  title: string
  statusOwner: string
  displayId: string
  hudId: string
  onReady(workbench: WorkbenchHandle): void
}>

/** One authored scene: right-handed Z-up, all spatial distances in millimetres. */
export function StorybookApp(props: StorybookAppProps) {
  const clipboard = getDocumentClipboardController(document as unknown as SemanticDocument)
  if (clipboard === null) throw new Error("Storybook requires the clipboard controller of its existing Browser Root")
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
    <hud id={props.hudId}>
      <Workbench
        title={props.title}
        statusOwner={props.statusOwner}
        displayId={props.displayId}
        onReady={props.onReady}
      />
      <ClipboardMenu controller={clipboard} />
    </hud>
  </space>
}
