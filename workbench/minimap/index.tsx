/**
Minimap показывает каталог в HUD того же Experience. Поиск, выбор страницы
и команды дерева используют общую панель с Display. «Скрыть» сворачивает
панель в перетаскиваемый Tab; кнопка «Minimap» возвращает то же дерево
с сохранением раскрытых ветвей и позиции прокрутки.

@packageDocumentation
*/
import {useState} from "@zavx0z/component"
import {Button} from "@zavx0z/ui/buttons/button"
import {Tab} from "@zavx0z/ui/surfaces/tab"
import {CatalogPanel} from "../catalog-panel"
import {WorkbenchRegionPanel} from "../components/region-panel.tsx"
import type {MinimapProps} from "./contract/input.ts"
export type {MinimapProps} from "./contract/input.ts"

/** Скрывает поверхность через CSS, сохраняя дерево и Tab в текущем Document. */
export function Minimap(props: MinimapProps) {
  const [collapsed, setCollapsed] = useState(props.initialCollapsed ?? false)
  return <div
    data-storybook-minimap=""
    style={css`
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    `}
  >
    <nav
      aria-label="Minimap"
      data-minimap-panel=""
      hidden={collapsed}
      style={css`
        position: absolute;
        top: 8px;
        left: 8px;
        display: flex;
        width: 300px;
        height: 480px;
        max-width: calc(100% - 16px);
        max-height: calc(100% - 16px);
        min-height: 0;
        pointer-events: auto;

        &[hidden] {
          display: none;
        }
      `}
    >
      <WorkbenchRegionPanel>
        <CatalogPanel
          label={props.catalog.label}
          search={props.catalog.search}
          items={props.catalog.items}
          activeId={props.catalog.activeId}
          management={props.catalog.management}
          onAction={props.catalog.onAction}
          onNavigate={props.catalog.onNavigate}
          onSearch={props.catalog.onSearch}
          onGroupToggle={props.catalog.onGroupToggle}
          navigationExpansion={props.catalog.navigationExpansion}
          onHide={() => setCollapsed(true)}
        />
      </WorkbenchRegionPanel>
    </nav>
    <div
      hidden={!collapsed}
      data-minimap-tab=""
      style={css`
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;

        &[hidden] {
          display: none;
        }
      `}
    >
      <Tab
        label="Minimap"
        position={{edge: "left", offset: .5}}
      >
        <Button
          label="Minimap"
          aria-label="Открыть Minimap"
          onClick={() => setCollapsed(false)}
        />
      </Tab>
    </div>
  </div>
}
