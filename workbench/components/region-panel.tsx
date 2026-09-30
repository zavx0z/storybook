import Pane from "@zavx0z/ui/surfaces/pane"
import type {JSX} from "@jsx-compiler/session"

export type WorkbenchRegionPanelProps = Readonly<{
  transparent?: boolean
  children: JSX.Element
}>

/** Shared visual frame for fixed Workbench regions. */
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
