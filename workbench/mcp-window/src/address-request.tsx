import {useEffect, useState} from "@zavx0z/component"
import {Button} from "@zavx0z/ui/buttons/button"
import type {McpRequestRecord} from "@mcp/rest/requests"
import {RequestList} from "./request-list"

/** Источник адресной строки и публичного ответа того же обработчика, который вызывает MCP. */
export interface McpAddressSource {
  readAddress(): string
  request(input: {node: string}, signal: AbortSignal): Promise<{result: unknown, failed: boolean}>
}

/**
Показывает запрос по pathname и query без восстановления адреса из состояния UI.
Смена адреса отменяет прежнее чтение; неизменный адрес не запускает повторное выполнение.
*/
export function AddressRequest(props: Readonly<{active: boolean, source?: McpAddressSource | undefined}>) {
  const [entry, setEntry] = useState<McpRequestRecord | null>(null)
  const [address, setAddress] = useState("")
  const [refresh, setRefresh] = useState(0)
  const addressLabel = props.source ? address : "Чтение текущего адреса не подключено."
  useEffect(() => {
    if (!props.active || !props.source) return
    const source = props.source
    let current: string | null = null
    let pending: AbortController | undefined
    let disposed = false
    const check = () => {
      const next = source.readAddress()
      if (current === next) return
      current = next
      pending?.abort()
      const controller = new AbortController()
      pending = controller
      const input = {node: next === "/" ? "root" : next.replace(/^\//u, "")}
      const startedAt = Date.now()
      const record: McpRequestRecord = {
        id: `address-${startedAt}-${refresh}`,
        tool: "storybook",
        startedAt,
        durationMs: null,
        status: "running",
        input: JSON.stringify(input, null, 2),
        result: "",
      }
      setAddress(next)
      setEntry(record)
      void source.request(input, controller.signal).then(reply => {
        if (disposed || controller.signal.aborted) return
        setEntry({...record, status: reply.failed ? "failed" : "success", durationMs: Date.now() - startedAt, result: JSON.stringify(reply.result, null, 2)})
      }).catch(error => {
        if (disposed || controller.signal.aborted) return
        setEntry({...record, status: "failed", durationMs: Date.now() - startedAt, result: JSON.stringify({error: error instanceof Error ? error.message : String(error)}, null, 2)})
      })
    }
    check()
    const timer = setInterval(check, 250)
    return () => {
      disposed = true
      clearInterval(timer)
      pending?.abort()
    }
  }, [props.active, props.source, refresh])
  return <div
    data-mcp-address=""
    hidden={!props.active}
    style={css`
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;

      &[hidden] {
        display: none;
      }
    `}
  >
    <div style={css`
      flex-shrink: 0;
      overflow-x: auto;
      padding: 0 6px;
    `}>{addressLabel}</div>
    <Button
      label="Обновить ответ"
      size="small"
      disabled={!props.source}
      onClick={() => setRefresh(value => value + 1)}
    />
    <RequestList
      entries={entry === null ? [] : [entry]}
      error=""
      history={false}
    />
  </div>
}
