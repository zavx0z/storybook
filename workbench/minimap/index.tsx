/**
Minimap показывает каталог в HUD того же Experience. Поиск, выбор страницы
и команды дерева используют общую панель с Display. «Скрыть» сворачивает
панель в перетаскиваемый Tab; кнопка «Minimap» возвращает то же дерево
с сохранением раскрытых ветвей и позиции прокрутки.

@packageDocumentation
*/
import {useId, useState} from "@zavx0z/component"
import {Window} from "@zavx0z/ui/surfaces/window"
import {WindowControl} from "@zavx0z/ui/surfaces/window/control"
import {Tab} from "@zavx0z/ui/surfaces/tab"
import {CatalogPanel} from "../catalog-panel"
import type {MinimapProps} from "./contract/input.ts"
export type {MinimapProps} from "./contract/input.ts"

/** Компонует общую оболочку Window и WindowControl в Tab того же Document. */
export function Minimap(props: MinimapProps) {
  const id = useId()
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
    <Window
      id={id}
      title="Minimap"
      open={!collapsed}
      onOpenChange={open => setCollapsed(!open)}
      geometry={{x: 8, y: 8, width: 300, height: 480}}
      movable={true}
      resizable={true}
    >
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
      />
    </Window>
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
        <WindowControl
          windowId={id}
          label="Minimap"
          open={!collapsed}
          onOpenChange={open => setCollapsed(!open)}
        />
      </Tab>
    </div>
  </div>
}
