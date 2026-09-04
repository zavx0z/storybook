import {CodeEditor} from "@zavx0z/ui/views/code-editor"
import {Pane} from "@zavx0z/ui/surfaces/pane"
import {Typography} from "@zavx0z/ui/typography"

export type ContractDocumentProps = Readonly<{
  title: string
  summary: string
  ownership: string
  example: string
}>

function ContractParagraph(props: Readonly<{text: string}>) {
  return <p style={css`
    margin: 0;
    white-space: normal;
  `}>
    <Typography text={props.text} variant="body" />
  </p>
}

function ContractContent(props: ContractDocumentProps) {
  return <article style={css`
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    gap: 10px;
    overflow: auto;
  `}>
    <h2 style={css`
      margin: 0;
    `}>
      <Typography text={props.title} variant="title" />
    </h2>
    <ContractParagraph text={props.summary} />
    <ContractParagraph text={props.ownership} />
    <CodeEditor
      value={props.example}
      readOnly={true}
      languageId="text"
      showLineNumbers={false}
      title={`${props.title} example`}
      style={css`
        width: 100%;
        height: 120px;
        min-height: 80px;
        flex-shrink: 0;
      `}
    />
  </article>
}

export function ContractDocument(props: ContractDocumentProps) {
  return <Pane style={css`
    width: 100%;
    height: 100%;
  `}>
    <ContractContent
      title={props.title}
      summary={props.summary}
      ownership={props.ownership}
      example={props.example}
    />
  </Pane>
}
