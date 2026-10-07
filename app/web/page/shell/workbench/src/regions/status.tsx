import {Breadcrumbs, type ImmersiveUiComponentNavigationBreadcrumb} from "@zavx0z/immersive-ui-component"
import {StatusBar} from "@zavx0z/immersive-ui-component"
import type {
  WorkbenchBreadcrumb,
  WorkbenchStatus,
} from "../types.ts"

export type StatusRegionProps = Readonly<{
  status: WorkbenchStatus
  onNavigate(item: WorkbenchBreadcrumb, source: HTMLElement): void
}>

/** Строка состояния сохраняет путь; домашняя ссылка показывает имя текущего Project. */
export function StatusRegion(props: StatusRegionProps) {
  const breadcrumbs: readonly WorkbenchBreadcrumb[] = props.status.breadcrumbs ?? Object.freeze([{
    id: "status-owner",
    label: props.status.owner,
    route: "",
  }])
  const items: readonly ImmersiveUiComponentNavigationBreadcrumb.Input["items"][number][] = breadcrumbs
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
      title={props.status.owner}
      separator=""
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
  </div>
}
