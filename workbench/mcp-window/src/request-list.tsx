import {memo, useEffect, useLayoutEffect, useRef, useState} from "@zavx0z/component"
import {CodeEditor} from "@zavx0z/ui/views/code-editor"
import {Button} from "@zavx0z/ui/buttons/button"
import type {McpRequestRecord} from "@mcp/rest/requests"
import {selectRequest} from "./selected-request"

/** Форматирует также старые компактные записи; высота зависит от числа строк. */
function JsonFieldView(props: Readonly<{title: string, value: string}>) {
  let value = props.value
  try { value = JSON.stringify(JSON.parse(value), null, 2) } catch {}
  const height = Math.max(1, value.split("\n").length) * 16 + 30
  return <section style={css`
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    min-width: 0;
    width: 100%;
    gap: 2px;
  `}>
    <div>{props.title}</div>
    <CodeEditor
      value={value}
      languageId="json"
      readOnly={true}
      showLineNumbers={false}
      style={css`
        --journal-field-height: ${height}px;

        width: 100%;
        max-width: 100%;
        min-width: 0;
        height: var(--journal-field-height);
        overflow-y: hidden;
        flex-shrink: 0;
      `}
    />
  </section>
}

const JsonField = memo(JsonFieldView)

/** Загружает небольшое превью сохранённого снимка отдельно от JSON журнала. */
function CapturePreview(props: Readonly<{captureId: string}>) {
  const [src, setSrc] = useState("")
  const [error, setError] = useState("")
  useEffect(() => {
    const abort = new AbortController()
    let objectUrl = ""
    void (async () => {
      const session = await fetch("/api/browser/registry-session", {method: "POST", headers: {"content-type": "application/json"}, body: "{}", signal: abort.signal})
      if (!session.ok) throw new Error("Не удалось открыть сессию снимка")
      const {readerToken} = await session.json()
      const response = await fetch(`/api/browser/mcp-captures/${encodeURIComponent(props.captureId)}`, {headers: {"x-storybook-session": readerToken}, signal: abort.signal})
      if (!response.ok) throw new Error("Снимок недоступен")
      const blob = await response.blob()
      if (abort.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setSrc(objectUrl)
    })().catch(cause => {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => {
      abort.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [props.captureId])
  return <div style={css`
    display: flex;
    flex-direction: column;
    width: 100%;
  `}>
    <div>Снимок</div>
    {src !== "" ? <CaptureImage src={src} /> : <CaptureMessage text={error || "Загрузка снимка…"} />}
  </div>
}

function CaptureImage(props: Readonly<{src: string}>) {
  return <img
    src={props.src}
    alt="Снимок Storybook"
    style={css`
      width: 240px;
      max-width: 100%;
      height: 140px;
      object-fit: contain;
    `}
  />
}

function CaptureMessage(props: Readonly<{text: string}>) {
  return <div>{props.text}</div>
}

/** Одна запись журнала; запрос и результат выводятся текстом без интерпретации разметки. */
function RequestRow(props: Readonly<{entry: McpRequestRecord}>) {
  const time = new Date(props.entry.startedAt).toLocaleTimeString()
  const duration = props.entry.durationMs === null ? "" : `${props.entry.durationMs} мс`
  return <article style={css`
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    flex-shrink: 0;
    padding: 6px;
    gap: 4px;
    border-bottom: 1px solid rgb(var(--surface-700));
  `}>
    <div>{time} · {props.entry.tool} · {props.entry.status} · {duration}</div>
    <JsonField title="Параметры запроса" value={props.entry.input} />
    {props.entry.captureId ? <CapturePreview captureId={props.entry.captureId} /> : null}
    <JsonField title="Ответ" value={props.entry.result} />
  </article>
}

/** Отрисовывает полный ответ только выбранной команды, сохраняя доступ к истории. */
function RequestListView(props: Readonly<{entries: readonly McpRequestRecord[], error: string, history?: boolean}>) {
  const list = useRef<HTMLDivElement | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const {entry, index, olderId, newerId} = selectRequest(props.entries, selectedId)
  const selectedEntries = entry === null ? [] : [entry]
  const position = entry === null ? "" : `Команда ${index + 1} из ${props.entries.length}`
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = 0
  }, [entry?.id])
  return <div
    style={css`
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      height: 100%;
      min-height: 0;
    `}
  >
    <div hidden={props.error === ""}>{props.error}</div>
    <div hidden={props.entries.length !== 0}>Запросов пока нет.</div>
    <div
      role="toolbar"
      aria-label="Команды журнала MCP"
      hidden={entry === null || props.history === false}
      style={css`
        display: flex;
        flex-wrap: wrap;
        flex-shrink: 0;
        align-items: center;
        gap: 6px;
        padding: 6px;

        &[hidden] {
          display: none;
        }
      `}
    >
      <Button
        label="Предыдущая команда"
        size="small"
        disabled={olderId === null}
        onClick={() => setSelectedId(olderId)}
      />
      <span>{position}</span>
      <Button
        label="Следующая команда"
        size="small"
        disabled={newerId === null}
        onClick={() => setSelectedId(newerId)}
      />
      <Button
        label="Следить за последней"
        size="small"
        disabled={selectedId === null}
        onClick={() => setSelectedId(null)}
      />
    </div>
    <div
      ref={list}
      style={css`
        flex: 1;
        min-height: 0;
        width: 100%;
        min-width: 0;
        overflow-y: auto;
        overflow-x: hidden;
      `}
    >
      {selectedEntries.map(entry => <RequestRow
        key={entry.id}
        entry={entry}
      />)}
    </div>
  </div>
}

export const RequestList = memo(RequestListView)
