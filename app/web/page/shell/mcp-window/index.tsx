/**
Окно среды показывает переданный ему журнал агента и ответ для текущего адреса Storybook.
Источник локального Display содержит только его агента. Общий источник всех
агентов показывается отдельным Window в HUD с journalOnly и собственным Tab.

В режиме «Вызовы» доступны параметры, полный ответ и история команд.
«Контекст» передаёт путь и параметры адресной строки тому же
источнику контекста. Смена адреса обновляет результат; «Обновить ответ» перечитывает
тот же адрес. Неподдерживаемые адреса показывают настоящую ошибку чтения контекста.
Положение, размер, видимость и режим восстанавливаются после
перезагрузки из локальных настроек браузера.
Выделение текста внутри JSON-поля ограничено этим полем и не захватывает
содержимое панелей под окном.
Параметры и ответ прокручиваются независимо. Короткий запрос занимает высоту
своего содержимого, длинный ограничен долей окна; ответ заполняет остаток.
Шапка и компактное управление остаются неподвижными при чтении данных.

@packageDocumentation
*/
import {type StorybookAppServerRequests as McpRestRequestsContract} from "@zavx0z/storybook-app-server-requests"
type McpRequestRecord = ReturnType<McpRestRequestsContract.Output["read"]>[number]
import {useEffect, useState} from "@zavx0z/immersive-component"
import Window from "@zavx0z/immersive-ui-component-surface-window"
import {McpContent} from "./src/content"
import {normalizeMcpWindowState} from "./src/state"
import type {StorybookAppWebPageShellMcpWindow} from "./contract"
export type {StorybookAppWebPageShellMcpWindow} from "./contract"

/** Содержимое журнала в общем Window; внешняя кнопка «Среда» управляет той же видимостью. */
export default function McpWindow(props: StorybookAppWebPageShellMcpWindow.Input) {
  const [entries, setEntries] = useState<readonly McpRequestRecord[]>([])
  const [error, setError] = useState("")
  const [initial] = useState(() => normalizeMcpWindowState(props.initialState))
  const [mode, setMode] = useState(props.journalOnly ? "agent" : initial.mode)
  const [geometry, setGeometry] = useState(initial.geometry)
  useEffect(() => {
    props.onStateChange?.({open: props.open, mode, geometry})
  }, [props.open, mode, geometry, props.onStateChange])
  useEffect(() => {
    if (!props.open || mode !== "agent" || !props.load) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        const result = await props.load!()
        if (active) {
          setEntries(previous => {
            if (previous.length === result.length && previous.every((entry, index) => {
              const next = result[index]
              return next?.id === entry.id && next.status === entry.status &&
                next.durationMs === entry.durationMs && next.input === entry.input && next.result === entry.result &&
                next.agentId === entry.agentId && next.address === entry.address
            })) return previous
            return result
          })
          setError("")
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      }
      if (active) timer = setTimeout(refresh, 1000)
    }
    void refresh()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [props.open, props.load, mode])
  return <div
    data-mcp-window=""
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
      id={props.id ?? "storybook-mcp-window"}
      title={props.title ?? "Среда"}
      open={props.open}
      onOpenChange={open => { if (!open) props.onClose() }}
      geometry={geometry}
      onGeometryChange={next => setGeometry(next)}
      movable={true}
      resizable={true}
      minWidth={320}
      minHeight={320}
    >
      <McpContent
        open={props.open}
        mode={mode}
        onMode={setMode}
        entries={entries}
        error={error}
        addressSource={props.addressSource}
        journalOnly={props.journalOnly}
      />
    </Window>
  </div>
}
