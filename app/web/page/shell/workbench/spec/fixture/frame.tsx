import Workbench, {type StorybookAppWebPageShellWorkbench} from "@zavx0z/storybook-app-web-page-shell-workbench"

/** Одна сцена передаёт Workbench уже существующие Display и HUD того же Document. */
export function WorkbenchFrame(props: StorybookAppWebPageShellWorkbench.Input) {
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
        initial={props.initial}
        userState={props.userState}
        navigationExpansion={props.navigationExpansion}
        displayId={props.displayId}
        hudId={props.hudId}
        onReady={props.onReady}
      />
    </display>
    <hud id={props.hudId} />
  </space>
}
