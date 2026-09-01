import type {Document, HTMLElement} from "@zavx0z/dom"
import type {JsxSourceElement} from "@zavx0z/template/jsx-runtime"
import type {
  WorkbenchNavigationGroup,
  WorkbenchNavigationItem,
  WorkbenchScenarioItem,
  WorkbenchViewState,
} from "./contract.ts"
import {CatalogRegion} from "./regions/catalog.tsx"
import {InspectorRegion} from "./regions/inspector.tsx"
import {PreviewRegion} from "./regions/preview.tsx"
import {ScenariosRegion} from "./regions/scenarios.tsx"
import {SecondaryRegion} from "./regions/secondary.tsx"
import {StatusRegion} from "./regions/status.tsx"

export type WorkbenchViewProps = Readonly<{
  document: Document
  state: WorkbenchViewState
  inspectorSelectedId: string
  inspectorQuery: string
  onCatalogNavigate(item: WorkbenchNavigationItem, source: HTMLElement): void
  onCatalogSearch(value: string, source: HTMLElement): void
  onGroupToggle(group: WorkbenchNavigationGroup, collapsed: boolean, source: HTMLElement): void
  onSecondaryNavigate(item: WorkbenchNavigationItem, source: HTMLElement): void
  onScenario(item: WorkbenchScenarioItem, source: HTMLElement): void
  onInspectorCategoryChange(id: string): void
  onInspectorQueryChange(query: string): void
  children: readonly JsxSourceElement[]
}>

/** One compiled six-region Workbench composition. */
export function WorkbenchView(props: WorkbenchViewProps) {
  const state = props.state
  const world = state.presentation.projection === "world"
  return <div
    role="application"
    aria-label={state.title}
    data-storybook-workbench=""
    data-storybook-world-preview={world ? "true" : undefined}
    style={css`
      & {
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
      }
      &[data-storybook-world-preview="true"] { background: transparent; }
    `}
  >
    <div
      data-storybook-workbench-part="body"
      data-world={world ? "true" : undefined}
      style={css`
        & {
          box-sizing: border-box;
          display: flex;
          flex-direction: row;
          min-height: 0;
          flex-grow: 1;
          gap: 4px;
          padding: 4px;
          overflow: clip;
          background: rgb(var(--surface-950));
        }
        &[data-world="true"] { background: transparent; }
      `}
    >
      <CatalogRegion
        document={props.document}
        label={state["catalog.label"]}
        search={state["catalog.search"]}
        items={state["catalog.items"]}
        activeId={state["catalog.active"]}
        onNavigate={props.onCatalogNavigate}
        onSearch={props.onCatalogSearch}
        onGroupToggle={props.onGroupToggle}
      />
      <SecondaryRegion
        label={state["secondary.label"]}
        items={state["secondary.items"]}
        activeId={state["secondary.active"]}
        onNavigate={props.onSecondaryNavigate}
      />
      <div style={css`
        & {
          display: flex;
          flex-direction: column;
          min-width: 0;
          min-height: 0;
          flex-grow: 1;
          gap: 4px;
        }
      `}>
        <ScenariosRegion
          label={state["scenarios.label"]}
          items={state["scenarios.items"]}
          activeId={state["scenarios.active"]}
          onScenario={props.onScenario}
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
    <StatusRegion status={state.status} />
  </div>
}
