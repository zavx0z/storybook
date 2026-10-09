/**
Единое окно настроек среды объединяет каталоги, модели по умолчанию и подключения.
Разделы расположены слева; панели и поля следуют общей теме UI.
Codex, сетевые подключения Ollama и Capsule настраиваются независимо.
Ollama принимает URL API и необязательный SSH-хост с существующими ключами.
Capsule принимает адрес Studio на машине исполнения, имя уже запущенного профиля
и сервис Qwen, DeepSeek или ChatGPT. При исполнении через SSH человек задаёт машину,
пути установленного Provider и его данных, необязательный контекст Docker.
Внутри сохранённых подключений Capsule и Chrome Studio открывается WebRTC-просмотр
уже запущенного профиля. Управление мышью и клавиатурой доступно у Capsule.
Сворачивание освобождает viewer, не останавливая браузер; несохранённое
подключение не запускает просмотр.
Chrome Studio подключает Qwen, DeepSeek или ChatGPT в уже запущенном профиле обычного
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
import Settings from "@zavx0z/immersive-ui-component-widget-settings"
import {SettingsContent} from "./src/content"
import {Directories} from "./src/directories"
import {windowState} from "./src/state"
import type {StorybookAppWebPageShellExecutionSettings} from "./contract"
export type {StorybookAppWebPageShellExecutionSettings} from "./contract"

/** Окно использует Document и HUD приложения; смена раздела сохраняет черновики. */
export default function ExecutionSettings(props: StorybookAppWebPageShellExecutionSettings.Input) {
  const [initial] = useState(() => windowState(props.initialState))
  const [open, setOpen] = useState(initial.open)
  const [geometry, setGeometry] = useState(initial.geometry)
  const [tab, setTab] = useState(initial.tab)
  const [section, setSection] = useState(props.directories ? "locations" : "defaults")
  const [executionVisited, setExecutionVisited] = useState(!props.directories)
  const [directoryError, setDirectoryError] = useState("")
  useEffect(() => props.onStateChange?.({open, geometry, tab}), [open, geometry, tab, props.onStateChange])
  const select = (id: string) => {
    setSection(id)
    if (id !== "locations") setExecutionVisited(true)
  }
  const sections = [
    ...(props.directories ? [{id: "locations", label: "Каталоги", group: "environment"}] : []),
    {id: "defaults", label: "Модели по умолчанию", group: "execution"},
    {id: "connections", label: "Провайдеры", group: "execution"},
  ]
  return <div
    data-execution-settings-window=""
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
      id="storybook-execution-settings"
      title="Настройки"
      open={open}
      onOpenChange={setOpen}
      geometry={geometry}
      onGeometryChange={(next, phase) => {if (phase !== "change") setGeometry(next)}}
      movable={true}
      resizable={true}
      minWidth={520}
      minHeight={320}
      message={directoryError ? {message: directoryError, tone: "error"} : undefined}
      onMessageDismiss={() => setDirectoryError("")}
    >
      <Settings
        sections={sections}
        selectedId={section}
        onSelect={select}
      >
        <SettingsPages
          section={section}
          open={open && executionVisited}
          fetcher={props.fetcher ?? globalThis.fetch}
          directories={props.directories}
          onDirectoryError={setDirectoryError}
          onSetup={() => {
            setSection("locations")
            setOpen(true)
          }}
          onClose={() => setOpen(false)}
        />
      </Settings>
    </Window>
    {open ? null : <Tab
      label="Настройки"
      position={tab}
      onPositionChange={(next, phase) => {if (phase === "end") setTab(next)}}
    >
      <WindowControl
        windowId="storybook-execution-settings"
        label="Настройки"
        open={open}
        onOpenChange={setOpen}
      />
    </Tab>}
  </div>
}

function SettingsPages(props: Readonly<{
  section: string
  open: boolean
  fetcher: typeof fetch
  directories: StorybookAppWebPageShellExecutionSettings.Input["directories"]
  onDirectoryError(message: string): void
  onSetup(): void
  onClose(): void
}>) {
  return <div style={css`
    height: 100%;
    min-height: 0;
  `}>
    <div
      hidden={props.section !== "locations"}
      style={css`
        height: 100%;
        min-height: 0;

        &[hidden] {
          display: none;
        }
      `}
    >
      {props.directories ? <Directories
        client={props.directories}
        onSetup={props.onSetup}
        onError={props.onDirectoryError}
        onClose={props.onClose}
      /> : null}
    </div>
    <div
      hidden={props.section === "locations"}
      style={css`
        height: 100%;
        min-height: 0;

        &[hidden] {
          display: none;
        }
      `}
    >
      <SettingsContent
        open={props.open}
        section={props.section === "connections" ? "connections" : "defaults"}
        fetcher={props.fetcher}
      />
    </div>
  </div>
}
