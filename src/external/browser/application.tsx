import {Space} from "@zavx0z/space/staging/space"
import {ViewPoint} from "@zavx0z/space/cameras/view-point"
import {HUD} from "@zavx0z/space/portals/hud"
import {Workbench} from "../../workbench/workbench.tsx"
import type {Workbench as WorkbenchHandle} from "../../workbench/contract.ts"
import {StorybookDisplay} from "./display-view.tsx"

export type StorybookAppProps = Readonly<{
  title: string
  statusOwner: string
  displayId: string
  hudId: string
  onReady(workbench: WorkbenchHandle): void
}>

/** One authored scene: right-handed Z-up, all spatial distances in millimetres. */
export function StorybookApp(props: StorybookAppProps) {
  return <Space>
    <ViewPoint
      x={0}
      y={-1000}
      z={0}
      targetX={0}
      targetY={0}
      targetZ={0}
      far={2000}
    />
    <StorybookDisplay id={props.displayId} />
    <HUD id={props.hudId}>
      <Workbench
        title={props.title}
        statusOwner={props.statusOwner}
        displayId={props.displayId}
        onReady={props.onReady}
      />
    </HUD>
  </Space>
}
