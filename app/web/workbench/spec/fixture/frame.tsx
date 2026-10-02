import Workbench, {type WebWorkbench} from "@web/workbench"

/** Одна сцена передаёт Workbench уже существующие Display и HUD того же Document. */
export function WorkbenchFrame(props: WebWorkbench.Input) {
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
    <display id={props.displayId}>
      <Workbench
        model={props.model}
        displayId={props.displayId}
        hudId={props.hudId}
        onReady={props.onReady}
      />
    </display>
    <hud id={props.hudId} />
  </space>
}
