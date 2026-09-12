import {memo, useEffect, useLayoutEffect, useRef, useState} from "@zavx0z/component"
import {CodeEditor} from "@zavx0z/ui/views/code-editor"
import type {McpRequestRecord} from "@mcp/rest/requests"

/** Форматирует также старые компактные записи; высота зависит от числа строк. */
function JsonField(props: Readonly<{title: string, value: string}>) {
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

/** Содержимое журнала передаётся в Window как единый компонент. */
function RequestListView(props: Readonly<{entries: readonly McpRequestRecord[], error: string}>) {
  const list = useRef<HTMLDivElement | null>(null)
  const newestId = props.entries[0]?.id
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = 0
  }, [newestId])
  return <div
    ref={list}
    style={css`
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
    `}
  >
    <div hidden={props.error === ""}>{props.error}</div>
    <div hidden={props.entries.length !== 0}>Запросов пока нет.</div>
    {props.entries.map(entry => <RequestRow
      key={entry.id}
      entry={entry}
    />)}
  </div>
}

export const RequestList = memo(RequestListView)
