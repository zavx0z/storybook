/**
Окно MCP показывает обращения агента и ответ для текущего адреса Storybook.

В режиме «Вызовы агента» доступны параметры, полный ответ и история команд.
«Текущий адрес → MCP» передаёт путь и параметры адресной строки тому же
обработчику MCP. Смена адреса обновляет результат; «Обновить ответ» перечитывает
тот же адрес. Неподдерживаемые адреса показывают настоящую ошибку MCP.
Положение, размер, видимость и режим восстанавливаются после
перезагрузки из локальных настроек браузера.
Выделение текста внутри JSON-поля ограничено этим полем и не захватывает
содержимое панелей под окном.

@packageDocumentation
*/
import {useEffect, useState} from "@zavx0z/component"
import Window from "@zavx0z/ui/surfaces/window"
import {McpContent} from "./src/content"
import type {McpAddressSource} from "./src/address-request"
import type {McpRequestRecord} from "@mcp/rest/requests"
import {defaultMcpWindowState, type McpWindowState} from "./src/state"

export type McpWindowProps = Readonly<{
  open: boolean
  onClose(): void
  load?: (() => Promise<readonly McpRequestRecord[]>) | undefined
  addressSource?: McpAddressSource | undefined
  initialState?: McpWindowState | undefined
  onStateChange?: ((state: McpWindowState) => void) | undefined
}>

/** Содержимое журнала в общем Window; внешняя кнопка MCP управляет той же видимостью. */
export function McpWindow(props: McpWindowProps) {
  const [entries, setEntries] = useState<readonly McpRequestRecord[]>([])
  const [error, setError] = useState("")
  const [mode, setMode] = useState(() => props.initialState?.mode ?? "agent")
  const [geometry, setGeometry] = useState(() => props.initialState?.geometry ?? defaultMcpWindowState().geometry)
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
                next.durationMs === entry.durationMs && next.input === entry.input && next.result === entry.result
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
      id="storybook-mcp-window"
      title="Журнал MCP"
      open={props.open}
      onOpenChange={open => { if (!open) props.onClose() }}
      geometry={geometry}
      onGeometryChange={next => setGeometry(next)}
      movable={true}
      resizable={true}
      minWidth={320}
      minHeight={200}
    >
      <McpContent
        open={props.open}
        mode={mode}
        onMode={setMode}
        entries={entries}
        error={error}
        addressSource={props.addressSource}
      />
    </Window>
  </div>
}
