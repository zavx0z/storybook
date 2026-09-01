import {TextField} from "@ui/components/fields/text-field"
import type {Document, Event, HTMLElement} from "@zavx0z/dom"
import {WorkbenchRegionPanel} from "../components/region-panel.tsx"
import type {
  WorkbenchNavigationGroup,
  WorkbenchNavigationItem,
} from "../contract.ts"
import {WorkbenchNavigationTree} from "../navigation/tree.tsx"

export type CatalogRegionProps = Readonly<{
  document: Document
  label: string
  search: string
  items: readonly WorkbenchNavigationItem[]
  activeId: string | null
  onNavigate(item: WorkbenchNavigationItem, source: HTMLElement): void
  onSearch(value: string, source: HTMLElement): void
  onGroupToggle(group: WorkbenchNavigationGroup, collapsed: boolean, source: HTMLElement): void
}>

function CatalogRegionContent(props: Readonly<{value: CatalogRegionProps}>) {
  const value = props.value
  const onSearch = (search: string, event: Event) => {
    value.onSearch(search, event.currentTarget as HTMLElement)
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
      `}
    >
      <TextField
        type="search"
        value={value.search}
        placeholder="Поиск…"
        title="Поиск по каталогу"
        aria-label="Поиск по каталогу"
        style={css`
          width: 100%;
        `}
        onInput={onSearch}
      />
    </div>
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
