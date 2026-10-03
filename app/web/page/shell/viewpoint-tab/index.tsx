/**
Перетаскиваемый Tab управления общим ViewPoint в HUD Storybook.
Приближение, заморозка жестов и вписывание используют существующий Browser Root.
Положение Tab, заморозка и обзор Workbench восстанавливаются между сессиями.
Workbench остаётся в Display; Tab не создаёт Window, камеру или отдельный Canvas.

@packageDocumentation
*/
import {useState} from "@zavx0z/component"
import {Tab} from "@zavx0z/ui"
import {ViewPointActions} from "./src/actions"
import type {WebViewpointTab} from "./contract"
export type {WebViewpointTab} from "./contract"

export default function ViewPointTab(props: WebViewpointTab.Input) {
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
