import Breadcrumbs, {type UiNavigationBreadcrumbs} from "@zavx0z/ui/navigation/breadcrumb"
import StatusBar from "@zavx0z/ui/feedback/status-bar"
import WindowControl from "@zavx0z/ui/surface/window/control"
import type {
  WorkbenchBreadcrumb,
  WorkbenchStatus,
} from "../types.ts"

export type StatusRegionProps = Readonly<{
  status: WorkbenchStatus
  onNavigate(item: WorkbenchBreadcrumb, source: HTMLElement): void
  mcpOpen?: boolean | undefined
  onMcpOpenChange?: ((open: boolean) => void) | undefined
}>

/** Строка состояния сохраняет путь; домашняя ссылка показывает имя текущего Project. */
export function StatusRegion(props: StatusRegionProps) {
  const title = `${props.status.lead}${props.status.owner}${props.status.detail}`
  const breadcrumbs: readonly WorkbenchBreadcrumb[] = props.status.breadcrumbs ?? Object.freeze([{
    id: "status-owner",
    label: props.status.owner,
    route: "",
  }])
  const items: readonly UiNavigationBreadcrumbs.Input["items"][number][] = breadcrumbs
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
    <WindowControl
      windowId="storybook-mcp-window"
      label="MCP"
      open={props.mcpOpen ?? false}
      onOpenChange={open => props.onMcpOpenChange?.(open)}
    />
  </div>
}
