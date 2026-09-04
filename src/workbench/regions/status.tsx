import {StatusBar} from "@zavx0z/ui/feedback/status-bar"
import type {WorkbenchStatus} from "../contract.ts"

export type StatusRegionProps = Readonly<{
  status: WorkbenchStatus
}>

/** Retained Workbench status region. */
export function StatusRegion(props: StatusRegionProps) {
  const title = `${props.status.lead}${props.status.owner}${props.status.detail}`
  return <div data-storybook-region="status">
    <StatusBar
      title={title}
      separator=""
      start={[
        {id: "workbench-status-lead", text: props.status.lead},
        {id: "workbench-status-owner", text: props.status.owner, highlighted: true},
        {id: "workbench-status-detail", text: props.status.detail},
      ]}
    />
  </div>
}
