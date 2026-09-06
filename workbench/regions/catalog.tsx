import {TextField, type TextFieldProps} from "@zavx0z/ui/fields/text-field"
import {Button} from "@zavx0z/ui/buttons/button"
import {plusIcon} from "@zavx0z/ui/themes/icons"
import type {Document as SemanticDocument} from "@zavx0z/dom"
import {WorkbenchRegionPanel} from "../components/region-panel.tsx"
import type {
  WorkbenchNavigationGroup,
  WorkbenchNavigationItem,
  WorkbenchCatalogAction,
  WorkbenchCatalogManagement,
} from "../contract.ts"
import {WorkbenchNavigationTree} from "../navigation/tree.tsx"

export type CatalogRegionProps = Readonly<{
  document: SemanticDocument
  label: string
  search: string
  items: readonly WorkbenchNavigationItem[]
  activeId: string | null
  management: WorkbenchCatalogManagement | null
  onAction(action: WorkbenchCatalogAction, source: HTMLElement): void
  onNavigate(item: WorkbenchNavigationItem, source: HTMLElement): void
  onSearch(value: string, source: HTMLElement): void
  onGroupToggle(group: WorkbenchNavigationGroup, collapsed: boolean, source: HTMLElement): void
}>

function CatalogRegionContent(props: Readonly<{value: CatalogRegionProps}>) {
  const value = props.value
  const onSearch: NonNullable<TextFieldProps["onInput"]> = (search, event) => {
    value.onSearch(search, event.currentTarget)
  }
  return <div style={css`
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 0;
    flex-grow: 1;
    gap: 2px;
  `}>
    <div
      data-storybook-part="catalog-search"
      style={css`
        display: flex;
        align-items: center;
        width: 100%;
        height: 24px;
        gap: 4px;
      `}
    >
      <TextField
        type="search"
        value={value.search}
        placeholder="Поиск…"
        title="Поиск по каталогу"
        aria-label="Поиск по каталогу"
        style={css`
          flex: 1;
          min-width: 0;
          --text-field-width: 100%;
        `}
        onInput={onSearch}
      />
      {value.management !== null ? <Button
        label=""
        startIcon={plusIcon}
        title="Добавить проект"
        aria-label="Добавить проект"
        disabled={value.management.pending}
        onClick={event => value.onAction({action: "attach"}, event.currentTarget)}
        style={css`
          flex-shrink: 0;
        `}
      /> : null}
    </div>
    <p
      hidden={value.management === null || value.management.error === ""}
      role="status"
      style={css`
        margin: 0;
        white-space: normal;

        &[hidden] {
          display: none;
        }
      `}
    >{value.management?.error ?? ""}</p>
    <div
      data-storybook-part="catalog-items"
      style={css`
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex-grow: 1;
      `}
    >
      <WorkbenchNavigationTree
        document={value.document}
        items={value.items}
        activeId={value.activeId}
        query={value.search}
        onNavigate={value.onNavigate}
        onGroupToggle={value.onGroupToggle}
        removableIds={value.management?.removableIds ?? []}
        onRemove={(item, source) => value.onAction({action: "detach", value: item.id}, source)}
      />
    </div>
  </div>
}

/** Primary catalog navigation and search region. */
export function CatalogRegion(props: CatalogRegionProps) {
  return <nav
    data-storybook-region="catalog"
    aria-label={props.label}
    style={css`
      display: flex;
      flex: 0 0 196px;
      width: 196px;
      min-height: 0;
    `}
  >
    <WorkbenchRegionPanel>
      <CatalogRegionContent value={props} />
    </WorkbenchRegionPanel>
  </nav>
}
