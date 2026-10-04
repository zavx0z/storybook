import CatalogPanel, {type WebCatalog} from "@web/catalog"
type CatalogPanelProps = WebCatalog.Input & Readonly<{hidden?: boolean}>
import {WorkbenchRegionPanel} from "../components/region-panel.tsx"

/** Вкладка дерева Inspector сохраняет навигацию при переключении секций. */
export function CatalogRegion(props: CatalogPanelProps) {
  return <nav
    data-storybook-region="catalog"
    aria-label={props.label}
    hidden={props.hidden}
    style={css`
      display: flex;
      flex-direction: column;
      flex-grow: 1;
      width: 100%;
      min-height: 0;

      &[hidden] {
        display: none;
      }
    `}
  >
    <WorkbenchRegionPanel>
      <CatalogPanel
        label={props.label}
        showSearch={false}
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
