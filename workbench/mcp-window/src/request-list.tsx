import {memo, useLayoutEffect, useRef} from "@zavx0z/component"
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
