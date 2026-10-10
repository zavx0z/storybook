/**
Minimap показывает каталог в HUD того же Experience. Без сохранённого состояния
ветви первоначально свёрнуты; сохранённое раскрытие имеет приоритет. Поиск, выбор страницы
и команды дерева используют общую панель с Display. «Скрыть» сворачивает
панель в перетаскиваемый Tab; кнопка с именем Project возвращает то же дерево
с сохранением раскрытых ветвей и позиции прокрутки.
Заголовок окна и управляющий Tab показывают переданное имя Project.
Host Storybook сохраняет видимость, размер и положение окна и Tab в localStorage.
Перемещение и resize записываются после завершения, отмена не меняет сохранённую раскладку.
Кнопка со значком «Пересобрать интерфейс» расположена рядом с действиями дерева
в строке поиска и вызывает предоставленную приложением операцию подготовки Web.
Ожидание блокирует повторный запуск; ошибка видна под строкой и допускает повтор.

@packageDocumentation
*/
import {useId, useRef, useState} from "@zavx0z/immersive/XReact"
import {Window} from "@zavx0z/immersive/ui"
import {WindowControl} from "@zavx0z/immersive/ui"
import {Tab} from "@zavx0z/immersive/ui"
import CatalogPanel from "@zavx0z/storybook-app-web-page-shell-workbench-catalog"
import {normalizeMinimapState} from "./src/state"
import type {StorybookAppWebPageShellMinimap} from "./contract"
export type {StorybookAppWebPageShellMinimap} from "./contract"

/** Компонует общую оболочку Window и WindowControl в Tab того же Document. */
export default function Minimap(props: StorybookAppWebPageShellMinimap.Input) {
  const id = useId()
  const [state, setState] = useState(() => normalizeMinimapState(props.initialState))
  const current = useRef(state)
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildError, setRebuildError] = useState("")
  const rebuildPending = useRef(false)
  /** Передаёт явное действие приложению и удерживает одну попытку до завершения подготовки. */
  const rebuildWeb = async (): Promise<void> => {
    if (rebuildPending.current || props.onRebuildWeb === undefined) return
    rebuildPending.current = true
    setRebuilding(true)
    setRebuildError("")
    try {
      await props.onRebuildWeb()
    } catch (error) {
      setRebuildError(error instanceof Error ? error.message : String(error))
    } finally {
      rebuildPending.current = false
      setRebuilding(false)
    }
  }
  /** Публикует один завершённый снимок, общий для оболочки и её управляющего Tab. */
  const update = (patch: Partial<StorybookAppWebPageShellMinimap.Output>) => {
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
      title={props.projectName}
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
        defaultCollapsed={true}
        search={props.catalog.search}
        items={props.catalog.items}
        activeId={props.catalog.activeId}
        management={props.catalog.management}
        onAction={props.catalog.onAction}
        onNavigate={props.catalog.onNavigate}
        onSearch={props.catalog.onSearch}
        onGroupToggle={props.catalog.onGroupToggle}
        navigationExpansion={props.catalog.navigationExpansion}
        webRebuild={props.onRebuildWeb === undefined ? undefined : {
          busy: rebuilding,
          error: rebuildError,
          onClick: () => { void rebuildWeb() },
        }}
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
        label={props.projectName}
        position={state.tab}
        onPositionChange={(tab, phase) => {
          if (phase === "end") update({tab})
        }}
      >
        <WindowControl
          windowId={id}
          label={props.projectName}
          open={!state.collapsed}
          onOpenChange={open => update({collapsed: !open})}
        />
      </Tab>
    </div>
  </div>
}
