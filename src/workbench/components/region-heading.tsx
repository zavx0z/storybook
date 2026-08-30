import {Typography} from "@ui/components/typography"

export type WorkbenchRegionHeadingProps = Readonly<{
  text: string
}>

/** Caption shared by the fixed Workbench regions. */
export function WorkbenchRegionHeading(props: WorkbenchRegionHeadingProps) {
  return <header style={css`
    & {
      display: block;
      min-height: 20px;
      padding: 2px 4px;
    }
  `}>
    <Typography text={props.text} variant="caption" />
  </header>
}
