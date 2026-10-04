import CatalogPanel, {type StorybookAppWebPageShellWorkbenchCatalog} from "@storybook-app-web-page-shell-workbench/catalog"
type CatalogPanelProps = StorybookAppWebPageShellWorkbenchCatalog.Input & Readonly<{hidden?: boolean}>
import {WorkbenchRegionPanel} from "../components/region-panel.tsx"

/** Ветка текущего адреса в Inspector: раскрытие без навигации и фильтра Minimap. */
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
        search=""
        items={props.items}
        activeId={props.activeId}
        management={null}
        onAction={props.onAction}
        onSearch={props.onSearch}
        onGroupToggle={props.onGroupToggle}
        navigationExpansion={props.navigationExpansion}
      />
    </WorkbenchRegionPanel>
  </nav>
}
