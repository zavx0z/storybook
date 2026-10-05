/**
Настройки подключений и общих параметров исполнителей доступны в HUD страницы.
Общие значения и переопределения по подтверждённым типам сущностей сохраняет
среда. Открытие выбора модели автоматически читает возможности адаптера,
не отправляя модели сообщений. Закрытие освобождает данные и незавершённые запросы.

@packageDocumentation
*/
import {useEffect, useState} from "@zavx0z/immersive-component"
import Window from "@zavx0z/immersive-ui-component-surface-window"
import Tab from "@zavx0z/immersive-ui-component-surface-tab"
import WindowControl from "@zavx0z/immersive-ui-component-surface-window-control"
import {SettingsContent} from "./src/content"
import {windowState} from "./src/state"
import type {StorybookAppWebPageShellExecutionSettings} from "./contract"
export type {StorybookAppWebPageShellExecutionSettings} from "./contract"

/** Окно и управляющий Tab находятся в том же HUD и semantic Document. */
export default function ExecutionSettings(props: StorybookAppWebPageShellExecutionSettings.Input) {
  const [initial] = useState(() => windowState(props.initialState))
  const [open, setOpen] = useState(initial.open)
  const [geometry, setGeometry] = useState(initial.geometry)
  const [tab, setTab] = useState(initial.tab)
  useEffect(() => props.onStateChange?.({open, geometry, tab}), [open, geometry, tab, props.onStateChange])
  return <div data-execution-settings-window="" style={css`
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  `}>
    <Window id="storybook-execution-settings" title="Подключения и модели" open={open}
      onOpenChange={setOpen} geometry={geometry} onGeometryChange={(next, phase) => {if (phase !== "change") setGeometry(next)}}
      movable={true} resizable={true} minWidth={340} minHeight={280}>
      <SettingsContent open={open} fetcher={props.fetcher ?? globalThis.fetch} />
    </Window>
    {open ? null : <Tab label="Подключения" position={tab} onPositionChange={(next, phase) => {if (phase === "end") setTab(next)}}>
      <WindowControl windowId="storybook-execution-settings" label="Подключения и модели" open={open} onOpenChange={setOpen} />
    </Tab>}
  </div>
}
