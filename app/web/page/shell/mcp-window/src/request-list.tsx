import {type StorybookAppServerRequests as McpRestRequestsContract} from "@zavx0z/storybook-app-server-requests"
type McpRequestRecord = ReturnType<McpRestRequestsContract.Output["read"]>[number]
import {memo, useEffect, useMemo, useState} from "@zavx0z/immersive/XReact"
import {CodeEditor} from "@zavx0z/immersive/ui"
import {Button} from "@zavx0z/immersive/ui"
import {selectRequest} from "./selected-request"
import formatJson from "@zavx0z/storybook-tech-json-format"

/** Полный JSON использует собственный viewport; input ограничен долей высоты, response заполняет остаток. */
function JsonFieldView(props: Readonly<{title: string, value: string, active?: boolean, fill?: boolean}>) {
  const {text: value, softBreaks, languageId} = useMemo(() => props.active === false
    ? {text: "", softBreaks: [], languageId: "plaintext" as const} : formatJson(props.value), [props.value, props.active])
  return <section
    data-journal-field={props.fill ? "response" : "input"}
    style={css`
      display: flex;
      flex-direction: column;
      flex: 0 1 auto;
      min-height: 52px;
      min-width: 0;
      width: 100%;
      max-height: 35%;
      gap: 2px;

      &[data-journal-field="response"] {
        flex: 1;
        max-height: none;
      }
    `}
  >
    <div style={css`
      flex-shrink: 0;
    `}>{props.title}</div>
    <CodeEditor
      value={value}
      languageId={languageId}
      readOnly={true}
      showLineNumbers={false}
      softBreaks={softBreaks}
      showFormattingCharacters={false}
      style={css`
        width: 100%;
        max-width: 100%;
        min-width: 0;
        height: auto;
        min-height: 34px;
        overflow-y: auto;
        flex: 1;
        user-select: contain;
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
    flex: 0 1 auto;
    min-height: 0;
    max-height: 25%;
    overflow: hidden;
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
      min-height: 0;
      object-fit: contain;
    `}
  />
}

function CaptureMessage(props: Readonly<{text: string}>) {
  return <div>{props.text}</div>
}

/** Одна запись журнала; запрос и результат выводятся текстом без интерпретации разметки. */
function RequestRow(props: Readonly<{entry: McpRequestRecord, active?: boolean}>) {
  const time = new Date(props.entry.startedAt).toLocaleTimeString()
  const duration = props.entry.durationMs === null ? "" : `${props.entry.durationMs} мс`
  return <article style={css`
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    flex: 1;
    min-height: 0;
    height: 100%;
    overflow: hidden;
    padding: 6px;
    gap: 4px;
    border-bottom: 1px solid rgb(var(--surface-700));
  `}>
    <div style={css`
      flex-shrink: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `}>{time} · {props.entry.tool} · {props.entry.status} · {duration}</div>
    <div
      hidden={props.entry.agentId === undefined}
      style={css`
        flex-shrink: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;

        &[hidden] {
          display: none;
        }
      `}
    >
      {props.entry.address ?? "Общий агент"} · {props.entry.agentId?.slice(0, 8)}
    </div>
    <div
      role="status"
      hidden={props.entry.omitted === undefined}
      style={css`
        flex-shrink: 0;

        &[hidden] {
          display: none;
        }
      `}
    >
      Содержимое выгружено из временного журнала для ограничения памяти.
      Запрос: {props.entry.omitted?.inputBytes ?? 0} байт;
      ответ: {props.entry.omitted?.resultBytes ?? 0} байт.
    </div>
    <JsonField
      title="Параметры запроса"
      value={props.entry.input}
      active={props.active !== false}
    />
    {props.entry.captureId && props.active !== false ? <CapturePreview captureId={props.entry.captureId} /> : null}
    <JsonField
      title="Ответ"
      value={props.entry.result}
      active={props.active !== false}
      fill={true}
    />
  </article>
}

/** Отрисовывает полный ответ только выбранной команды, сохраняя доступ к истории. */
function RequestListView(props: Readonly<{entries: readonly McpRequestRecord[], error: string, history?: boolean, active?: boolean}>) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const {entry, index, olderId, newerId} = selectRequest(props.entries, selectedId)
  const selectedEntries = entry === null ? [] : [entry]
  const position = entry === null ? "" : `${index + 1} / ${props.entries.length}`
  const positionLabel = entry === null ? "" : `Команда ${index + 1} из ${props.entries.length}`
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
    <div hidden={props.entries.length !== 0}>Вызовов пока нет.</div>
    <div
      role="toolbar"
      aria-label="Навигация по вызовам"
      hidden={entry === null || props.history === false}
      style={css`
        display: flex;
        flex-wrap: nowrap;
        flex-shrink: 0;
        align-items: center;
        gap: 6px;
        padding: 6px;
        overflow: hidden;

        &[hidden] {
          display: none;
        }
      `}
    >
      <Button
        label="Ранее"
        aria-label="Предыдущий вызов"
        title="Предыдущий вызов"
        size="small"
        disabled={olderId === null}
        onClick={() => setSelectedId(olderId)}
      />
      <span
        aria-label={positionLabel}
        title={positionLabel}
        style={css`
          min-width: 0;
          white-space: nowrap;
        `}
      >{position}</span>
      <Button
        label="Новее"
        aria-label="Следующий вызов"
        title="Следующий вызов"
        size="small"
        disabled={newerId === null}
        onClick={() => setSelectedId(newerId)}
      />
      <Button
        label="Последняя"
        aria-label="Следить за последней"
        title="Следить за последней"
        size="small"
        disabled={selectedId === null}
        onClick={() => setSelectedId(null)}
      />
    </div>
    <div
      data-journal-fields=""
      style={css`
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        width: 100%;
        min-width: 0;
        overflow: hidden;
      `}
    >
      {selectedEntries.map(entry => <RequestRow
        key={entry.id}
        entry={entry}
        active={props.active !== false}
      />)}
    </div>
  </div>
}

export const RequestList = memo(RequestListView)
