/**
Настройки подключений и общих параметров исполнителей доступны в HUD страницы.
Codex, сетевые подключения Ollama и Capsule настраиваются независимо.
Ollama принимает URL API и необязательный SSH-хост с существующими ключами.
Capsule принимает адрес Studio на машине исполнения, имя уже запущенного профиля
и сервис Qwen или DeepSeek. При исполнении через SSH человек задаёт машину,
пути установленного Provider и его данных, необязательный контекст Docker.
Внутри сохранённых подключений Capsule и Chrome Studio открывается WebRTC-просмотр
уже запущенного профиля. Управление мышью и клавиатурой доступно у Capsule.
Сворачивание освобождает viewer, не останавливая браузер; несохранённое
подключение не запускает просмотр.
Chrome Studio подключает Qwen или DeepSeek в уже запущенном профиле обычного
Chrome. Адрес Studio и имя профиля определяют подключение; CDP назначает и
проверяет сама Studio. При SSH исполнение и хранилище Provider находятся на
той же машине, что Chrome Studio; Docker для этого подключения не требуется.
Общие значения
и переопределения по подтверждённым типам сущностей сохраняет среда. Открытие выбора модели автоматически читает возможности адаптера,
не отправляя модели сообщений. Проверка подключения использует только сохранённые настройки.
Закрытие освобождает данные и незавершённые запросы.

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
    <Window id="storybook-execution-settings" title="Провайдеры и модели" open={open}
      onOpenChange={setOpen} geometry={geometry} onGeometryChange={(next, phase) => {if (phase !== "change") setGeometry(next)}}
      movable={true} resizable={true} minWidth={340} minHeight={280}>
      <SettingsContent open={open} fetcher={props.fetcher ?? globalThis.fetch} />
    </Window>
    {open ? null : <Tab label="Провайдеры и модели" position={tab} onPositionChange={(next, phase) => {if (phase === "end") setTab(next)}}>
      <WindowControl windowId="storybook-execution-settings" label="Провайдеры и модели" open={open} onOpenChange={setOpen} />
    </Tab>}
  </div>
}
