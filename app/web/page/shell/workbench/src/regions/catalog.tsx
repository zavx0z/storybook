import CatalogPanel, {type WebCatalog} from "@web/catalog"
type CatalogPanelProps = WebCatalog.Input
import {WorkbenchRegionPanel} from "../components/region-panel.tsx"

/** Навигационная область Display использует общую панель каталога. */
export function CatalogRegion(props: CatalogPanelProps) {
  return <nav
    data-storybook-region="catalog"
    aria-label={props.label}
    style={css`
      display: flex;
      flex: 0 0 300px;
      width: 300px;
      min-height: 0;
    `}
  >
    <WorkbenchRegionPanel>
      <CatalogPanel
        label={props.label}
        search={props.search}
        items={props.items}
        activeId={props.activeId}
        management={props.management}
        onAction={props.onAction}
        onNavigate={props.onNavigate}
        onSearch={props.onSearch}
        onGroupToggle={props.onGroupToggle}
        navigationExpansion={props.navigationExpansion}
      />
    </WorkbenchRegionPanel>
  </nav>
}
