import {CodeEditor} from "@ui/components/code-editor"
import {Typography} from "@ui/components/typography"

type SourceDocument = Readonly<{
  key: string
  label: string
  languageId: "css" | "html" | "typescript"
  value: string
}>

type SourceDocumentViewProps = Readonly<{
  document: SourceDocument
}>

function SourceDocumentView(props: SourceDocumentViewProps) {
  return <section
    data-source-document={props.document.key}
    style={css`
      & {
        display: flex;
        flex-direction: column;
        width: 100%;
        gap: 2px;
      }
    `}
  >
    <Typography text={props.document.label} variant="caption" />
    <CodeEditor
      value={props.document.value}
      readOnly={true}
      languageId={props.document.languageId}
      title={props.document.label}
      style={css`
        & {
          width: 100%;
          height: 180px;
          min-height: 120px;
        }
      `}
    />
  </section>
}

export function SourceWidget(props: Readonly<{value: unknown}>) {
  const documents = sourceDocuments(props.value)
  return <div style={css`
    & {
      display: flex;
      flex-direction: column;
      width: 100%;
      min-height: 0;
      gap: 6px;
    }
  `}>
    {documents.map(document => <SourceDocumentView key={document.key} document={document} />)}
  </div>
}

function sourceDocuments(value: unknown): readonly SourceDocument[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze([
      Object.freeze({key: "html", label: "HTML", languageId: "html", value: ""}),
      Object.freeze({key: "typescript", label: "TypeScript", languageId: "typescript", value: ""}),
    ])
  }
  const source = value as Readonly<{
    html?: unknown
    css?: Readonly<{
      authorStyleSheets?: readonly Readonly<{specifier?: unknown; cssText?: unknown}>[]
      componentStyleSheets?: readonly Readonly<{
        moduleId?: unknown
        componentName?: unknown
        cssText?: unknown
      }>[]
    }>
    typescript?: unknown
  }>
  const documents: SourceDocument[] = [Object.freeze({
    key: "html",
    label: "HTML",
    languageId: "html",
    value: typeof source.html === "string" ? source.html : "",
  })]
  for (const [index, sheet] of (source.css?.authorStyleSheets ?? []).entries()) {
    documents.push(Object.freeze({
      key: `author:${index}`,
      label: typeof sheet.specifier === "string" ? sheet.specifier : `Author CSS ${index + 1}`,
      languageId: "css",
      value: typeof sheet.cssText === "string" ? sheet.cssText : "",
    }))
  }
  for (const [index, sheet] of (source.css?.componentStyleSheets ?? []).entries()) {
    const moduleId = typeof sheet.moduleId === "string" ? sheet.moduleId : `Component ${index + 1}`
    const componentName = typeof sheet.componentName === "string" ? sheet.componentName : "CSS"
    documents.push(Object.freeze({
      key: `component:${index}`,
      label: `${moduleId} · ${componentName}`,
      languageId: "css",
      value: typeof sheet.cssText === "string" ? sheet.cssText : "",
    }))
  }
  documents.push(Object.freeze({
    key: "typescript",
    label: "TypeScript",
    languageId: "typescript",
    value: typeof source.typescript === "string" ? source.typescript : "",
  }))
  return Object.freeze(documents)
}
