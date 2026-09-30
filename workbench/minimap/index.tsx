/**
Minimap показывает каталог в HUD того же Experience. Поиск, выбор страницы
и команды дерева используют общую панель с Display. «Скрыть» сворачивает
панель в перетаскиваемый Tab; кнопка «Minimap» возвращает то же дерево
с сохранением раскрытых ветвей и позиции прокрутки.
Host Storybook сохраняет видимость, размер и положение окна и Tab в localStorage.
Перемещение и resize записываются после завершения, отмена не меняет сохранённую раскладку.

@packageDocumentation
*/
import {useId, useRef, useState} from "@zavx0z/component"
import Window from "@zavx0z/ui/surface/window"
import WindowControl from "@zavx0z/ui/surface/window/control"
import Tab from "@zavx0z/ui/surface/tab"
import {CatalogPanel} from "../catalog-panel"
import {defaultMinimapState, type MinimapState} from "./src/state.ts"
import type {MinimapProps} from "./contract/input.ts"
export type {MinimapProps} from "./contract/input.ts"

/** Компонует общую оболочку Window и WindowControl в Tab того же Document. */
export function Minimap(props: MinimapProps) {
  const id = useId()
  const [state, setState] = useState(() => props.initialState ?? defaultMinimapState())
  const current = useRef(state)
  /** Публикует один завершённый снимок, общий для оболочки и её управляющего Tab. */
  const update = (patch: Partial<MinimapState>) => {
    const next = {...current.current, ...patch}
    current.current = next
    setState(next)
    props.onStateChange?.(next)
  }
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
      open={!state.collapsed}
      onOpenChange={open => update({collapsed: !open})}
      geometry={state.geometry}
      onGeometryChange={(geometry, phase) => {
        if (phase === "end") update({geometry})
      }}
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
      hidden={!state.collapsed}
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
        position={state.tab}
        onPositionChange={(tab, phase) => {
          if (phase === "end") update({tab})
        }}
      >
        <WindowControl
          windowId={id}
          label="Minimap"
          open={!state.collapsed}
          onOpenChange={open => update({collapsed: !open})}
        />
      </Tab>
    </div>
  </div>
}
