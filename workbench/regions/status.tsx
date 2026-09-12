import {
  Breadcrumbs,
  type BreadcrumbsItem,
} from "@zavx0z/ui/navigation/breadcrumbs"
import {StatusBar} from "@zavx0z/ui/feedback/status-bar"
import {Button} from "@zavx0z/ui/buttons/button"
import type {
  WorkbenchBreadcrumb,
  WorkbenchStatus,
} from "../contract.ts"

export type StatusRegionProps = Readonly<{
  status: WorkbenchStatus
  onNavigate(item: WorkbenchBreadcrumb, source: HTMLElement): void
  onMcpOpen?: (() => void) | undefined
}>

/** Retained Workbench status region. */
export function StatusRegion(props: StatusRegionProps) {
  const title = `${props.status.lead}${props.status.owner}${props.status.detail}`
  const breadcrumbs = props.status.breadcrumbs ?? Object.freeze([{
    id: "status-owner",
    label: props.status.owner,
    route: "",
  }])
  const items: readonly BreadcrumbsItem[] = breadcrumbs
  return <div data-storybook-region="status" style={css`
    display: flex;
    flex-direction: row;
    width: 100%;
    align-items: center;
  `}>
    <StatusBar
      style={css`
        flex-grow: 1;
        width: 0;
      `}
      title={title}
      separator=""
      end={props.status.detail === "" ? [] : [{
        id: "workbench-status-detail",
        text: props.status.detail,
      }]}
    >
      <Breadcrumbs
        items={items}
        label="Текущий путь"
        onNavigate={(item, event) => {
          const source = breadcrumbs.find(candidate => candidate.id === item.id)
          if (source !== undefined) props.onNavigate(source, event.currentTarget as HTMLElement)
        }}
      />
    </StatusBar>
    <Button
      label="MCP"
      title="Открыть журнал запросов MCP"
      aria-label="Открыть журнал MCP"
      size="small"
      onClick={() => props.onMcpOpen?.()}
    />
  </div>
}
