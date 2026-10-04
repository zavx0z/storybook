/**
Перетаскиваемый Tab управления общим ViewPoint в HUD Storybook.
Приближение, заморозка жестов и вписывание используют существующий Browser Root.
Положение Tab, заморозка и обзор Workbench восстанавливаются между сессиями.
Workbench остаётся в Display; Tab не создаёт Window, камеру или отдельный Canvas.

@packageDocumentation
*/
import {useState} from "@immersive/component"
import {Tab} from "@immersive-ui/component"
import {ViewPointActions} from "./src/actions"
import type {StorybookAppWebPageShellViewpointTab} from "./contract"
export type {StorybookAppWebPageShellViewpointTab} from "./contract"

export default function ViewPointTab(props: StorybookAppWebPageShellViewpointTab.Input) {
  const initialPosition = props.controls.initialPosition
  const [vertical, setVertical] = useState(initialPosition.edge === "left" || initialPosition.edge === "right")
  return <Tab
    label="ViewPoint"
    position={initialPosition}
    onPositionChange={position => {
      setVertical(position.edge === "left" || position.edge === "right")
      props.controls.savePosition(position)
    }}
  >
    <ViewPointActions
      controls={props.controls}
      vertical={vertical}
    />
  </Tab>
}
