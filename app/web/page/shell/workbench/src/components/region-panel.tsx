import {Pane} from "@zavx0z/immersive/ui"
import type {JSX} from "@zavx0z/immersive/XReact"

export type WorkbenchRegionPanelProps = Readonly<{
  transparent?: boolean
  children: JSX.Element
}>

/** Общая визуальная рамка фиксированных областей Workbench. */
export function WorkbenchRegionPanel(props: WorkbenchRegionPanelProps) {
  return <Pane
    variant={props.transparent === true ? "outlined" : "filled"}
    style={css`
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      gap: 2px;
    `}
  >
    {props.children}
  </Pane>
}
