import type {Document as SemanticDocument} from "@zavx0z/dom"
import type {JsxSourceElement} from "@zavx0z/template/jsx-runtime"
import type {
  WorkbenchNavigationGroup,
  WorkbenchCatalogAction,
  WorkbenchNavigationItem,
  WorkbenchBreadcrumb,
  WorkbenchTabItem,
  WorkbenchViewState,
} from "./contract.ts"
import {CatalogRegion} from "./regions/catalog.tsx"
import {InspectorRegion} from "./regions/inspector.tsx"
import {PreviewRegion} from "./regions/preview.tsx"
import {TabsRegion} from "./regions/tabs.tsx"
import {SecondaryRegion} from "./regions/secondary.tsx"
import {StatusRegion} from "./regions/status.tsx"

export type WorkbenchViewProps = Readonly<{
  onMcpOpen?: (() => void) | undefined
  document: SemanticDocument
  onElement?: ((node: HTMLDivElement | null) => void) | undefined
  state: WorkbenchViewState
  inspectorSelectedId: string
  inspectorQuery: string
  onCatalogAction(action: WorkbenchCatalogAction, source: HTMLElement): void
  onCatalogNavigate(item: WorkbenchNavigationItem, source: HTMLElement): void
  onCatalogSearch(value: string, source: HTMLElement): void
  onGroupToggle(group: WorkbenchNavigationGroup, collapsed: boolean, source: HTMLElement): void
  onSecondaryNavigate(item: WorkbenchNavigationItem, source: HTMLElement): void
  onTab(item: WorkbenchTabItem, source: HTMLElement): void
  onInspectorCategoryChange(id: string): void
  onInspectorQueryChange(query: string): void
  onStatusNavigate(item: WorkbenchBreadcrumb, source: HTMLElement): void
  children: readonly JsxSourceElement[]
}>

/** One compiled six-region Workbench composition. */
export function WorkbenchView(props: WorkbenchViewProps) {
  const state = props.state
  const content = state.presentation.projection !== "hud"
  return <div
    ref={props.onElement}
    role="application"
    aria-label={state.title}
    data-storybook-workbench=""
    data-storybook-content-preview={content ? "true" : undefined}
    style={css`
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow: clip;
      background: rgb(var(--surface-925));
      color: var(--widget-regular-content);
      font-size: 11px;
      line-height: 16px;

      &[data-storybook-content-preview="true"] {
        background: transparent;
      }
    `}
  >
    <div
      data-storybook-workbench-part="body"
      data-content={content ? "true" : undefined}
      style={css`
        box-sizing: border-box;
        display: flex;
        flex-direction: row;
        min-height: 0;
        flex-grow: 1;
        gap: 4px;
        padding: 4px;
        overflow: clip;
        background: rgb(var(--surface-950));

        &[data-content="true"] {
          background: transparent;
        }
      `}
    >
      <CatalogRegion
        document={props.document}
        label={state["catalog.label"]}
        management={state["catalog.management"]}
        onAction={props.onCatalogAction}
        search={state["catalog.search"]}
        items={state["catalog.items"]}
        activeId={state["catalog.active"]}
        onNavigate={props.onCatalogNavigate}
        onSearch={props.onCatalogSearch}
        onGroupToggle={props.onGroupToggle}
      />
      <SecondaryRegion
        document={props.document}
        label={state["secondary.label"]}
        items={state["secondary.items"]}
        activeId={state["secondary.active"]}
        onNavigate={props.onSecondaryNavigate}
      />
      <div style={css`
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        flex-grow: 1;
      `}>
        <TabsRegion
          label={state["tabs.label"]}
          items={state["tabs.items"]}
          activeId={state["tabs.active"]}
          onTab={props.onTab}
        />
        <PreviewRegion
          label={state["preview.label"]}
          projection={state.presentation.projection}
        />
      </div>
      <InspectorRegion
        registry={state["inspector.registry"]}
        subject={state["inspector.subject"]}
        selectedId={props.inspectorSelectedId}
        query={props.inspectorQuery}
        onCategoryChange={props.onInspectorCategoryChange}
        onQueryChange={props.onInspectorQueryChange}
      >{props.children}</InspectorRegion>
    </div>
    <StatusRegion
      onMcpOpen={props.onMcpOpen}
      status={state.status}
      onNavigate={props.onStatusNavigate}
    />
  </div>
}
