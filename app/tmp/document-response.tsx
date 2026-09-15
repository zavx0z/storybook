import {memo, useMemo, useState} from "@zavx0z/component"
import {CodeEditor} from "@zavx0z/ui/views/code-editor"
import {Button} from "@zavx0z/ui/buttons/button"
import {Markdown} from "@webxr/markdown"

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

function DocumentResponse(props: Readonly<{source: string}>) {
  return <Markdown
    source={props.source}
    style={css`
      flex-shrink: 0;
      overflow: visible;
      padding: 8px;
    `}
  />
}

/** Читаемый документ и исходный JSON — два представления одной неизменённой записи. */
export function ResponseField(props: Readonly<{value: string}>) {
  const document = useMemo(() => {
    try {
      const result = JSON.parse(props.value)
      return typeof result?.documentation === "string" ? result.documentation as string : null
    } catch { return null }
  }, [props.value])
  const [showData, setShowData] = useState(false)
  const label = showData ? "Читать документ" : "Показать JSON ответа"
  return <section style={css`
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    min-width: 0;
    width: 100%;
    gap: 6px;
  `}>
    {document === null ? null : <Button
      label={label}
      size="small"
      onClick={() => setShowData(value => !value)}
    />}
    {document !== null && !showData ? <DocumentResponse source={document} /> : <JsonField title="Ответ" value={props.value} />}
  </section>
}
