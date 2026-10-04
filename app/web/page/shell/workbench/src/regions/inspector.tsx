import type {Zavx0zStorybookAppWebPageShellWorkbenchCatalog} from "@zavx0z/storybook-app-web-page-shell-workbench-catalog"
import {CatalogRegion} from "./catalog"
import type {JSX} from "@zavx0z/immersive-jsx-compiler-session"
import type {
  WorkbenchInspectorSubject,
  WorkbenchInspectorWidgetRegistration,
} from "../types.ts"
import {WorkbenchInspector} from "../inspector/panel.tsx"

export type InspectorRegionProps = Readonly<{
  catalog: Zavx0zStorybookAppWebPageShellWorkbenchCatalog.Input
  registry: readonly WorkbenchInspectorWidgetRegistration[]
  subject: WorkbenchInspectorSubject | null
  selectedId: string
  query: string
  onCategoryChange(id: string): void
  onQueryChange(query: string): void
  children: readonly JSX.Element[]
}>

/** Фиксированная область с одним production Inspector. */
export function InspectorRegion(props: InspectorRegionProps) {
  return <div
    data-storybook-region="inspector"
    style={css`
      display: flex;
      flex: 0 0 400px;
      width: 400px;
      min-height: 0;
      overflow: clip;
    `}
  >
    <WorkbenchInspector
      registry={props.registry}
      subject={props.subject}
      selectedId={props.selectedId}
      query={props.query}
      onCategoryChange={props.onCategoryChange}
      onQueryChange={props.onQueryChange}
    >
      <InspectorContents
        catalog={props.catalog}
        selectedId={props.selectedId}
      >
        {props.children}
      </InspectorContents>
    </WorkbenchInspector>
  </div>
}


/** Содержимое секций остаётся смонтированным при переключении вкладки дерева. */
function InspectorContents(props: Readonly<{
  catalog: Zavx0zStorybookAppWebPageShellWorkbenchCatalog.Input
  selectedId: string
}>): JSX.Element<{default: readonly JSX.Element[]}> {
  return <div style={css`
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex-grow: 1;
  `}>
    <CatalogRegion
      hidden={props.selectedId !== "tree"}
      label={props.catalog.label}
      management={props.catalog.management}
      onAction={props.catalog.onAction}
      search={props.catalog.search}
      items={props.catalog.items}
      activeId={props.catalog.activeId}
      onNavigate={props.catalog.onNavigate}
      onSearch={props.catalog.onSearch}
      onGroupToggle={props.catalog.onGroupToggle}
      navigationExpansion={props.catalog.navigationExpansion}
    />
    <slot />
  </div>
}
