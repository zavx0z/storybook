import {useEffect, useRef, useState} from "@zavx0z/component"
import {Window} from "@zavx0z/ui/surfaces/window"
import {RequestList} from "./src/request-list.tsx"
import type {McpRequestRecord} from "@mcp/rest/requests"

export type McpWindowProps = Readonly<{
  open: boolean
  onClose(): void
  load?: (() => Promise<readonly McpRequestRecord[]>) | undefined
}>

/** Окно журнала в существующем HUD; перемещение и размер используют публичные pointer-события DOM. */
export function McpWindow(props: McpWindowProps) {
  const element = useRef<HTMLDivElement | null>(null)
  const [entries, setEntries] = useState<readonly McpRequestRecord[]>([])
  const [error, setError] = useState("")
  const [minimized, setMinimized] = useState(false)
  const [geometry, setGeometry] = useState({x: 24, y: 24, width: 620, height: 400})
  const gesture = useRef<{mode: "move" | "resize", pointer: number, x: number, y: number, box: typeof geometry} | null>(null)
  useEffect(() => {
    if (!props.open || !props.load) return
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
  }, [props.open, props.load])
  const start = (event: PointerEvent, mode: "move" | "resize") => {
    if (event.button !== 0 || !element.current) return
    gesture.current = {mode, pointer: event.pointerId, x: event.clientX, y: event.clientY, box: geometry}
    element.current.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const move = (event: PointerEvent) => {
    const current = gesture.current
    if (!current || current.pointer !== event.pointerId) return
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    setGeometry(current.mode === "move"
      ? {...current.box, x: Math.max(0, current.box.x + dx), y: Math.max(0, current.box.y + dy)}
      : {...current.box, width: Math.max(320, current.box.width + dx), height: Math.max(200, current.box.height + dy)})
  }
  const end = (event: PointerEvent) => {
    if (gesture.current?.pointer !== event.pointerId) return
    gesture.current = null
    element.current?.releasePointerCapture(event.pointerId)
  }
  return <div
    ref={element}
    hidden={!props.open}
    role="dialog"
    aria-label="Журнал MCP"
    data-mcp-window=""
    onPointerDown={event => {
      const target = event.target as HTMLElement | null
      if (target?.closest("header") && !target.closest("button")) start(event, "move")
    }}
    onPointerMove={move}
    onPointerUp={end}
    onPointerCancel={end}
    style={css`
      --mcp-x: ${geometry.x}px;
      --mcp-y: ${geometry.y}px;
      --mcp-width: ${geometry.width}px;
      --mcp-height: ${geometry.height}px;

      position: fixed;
      left: var(--mcp-x, 24px);
      top: var(--mcp-y, 24px);
      width: var(--mcp-width, 620px);
      height: var(--mcp-height, 400px);
      z-index: 1000;
      display: flex;
      flex-direction: column;

      &[hidden] {
        display: none;
      }
    `}
  >
    <Window
      title="Журнал MCP"
      subtitle="Последние 200 запросов · перетащите заголовок"
      active={true}
      minimized={minimized}
      layout="fill"
      actions={[{key: "close", label: "Закрыть", disabled: false}]}
      onMinimizedChange={setMinimized}
      onAction={() => props.onClose()}
    >
      <RequestList entries={entries} error={error} />
    </Window>
    <button
      type="button"
      aria-label="Изменить размер окна MCP"
      title="Перетащите для изменения размера"
      hidden={minimized}
      onPointerDown={event => {
        event.stopPropagation()
        start(event, "resize")
      }}
      style={css`
        position: absolute;
        right: 2px;
        bottom: 2px;
        width: 20px;
        height: 20px;
        cursor: nwse-resize;

        &[hidden] {
          display: none;
        }
      `}
    >↘</button>
  </div>
}
