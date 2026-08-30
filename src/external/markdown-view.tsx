import {Button} from "@ui/components/button"
import {CodeEditor} from "@ui/components/code-editor"
import type {Event} from "@zavx0z/dom"
import type {StorybookOverviewAction} from "./browser/landing-view.tsx"
import type {
  StorybookMarkdownBlock,
  StorybookMarkdownDocument,
  StorybookMarkdownInline,
} from "./markdown.ts"

export type StorybookMarkdownViewProps = Readonly<{
  markdown: StorybookMarkdownDocument
  action?: StorybookOverviewAction
}>

type MarkdownInlineProps = Readonly<{inline: StorybookMarkdownInline}>
type MarkdownInlineListProps = Readonly<{content: readonly StorybookMarkdownInline[]}>
type MarkdownBlockProps = Readonly<{block: StorybookMarkdownBlock}>
type MarkdownListProps = Readonly<{
  items: Extract<StorybookMarkdownBlock, {kind: "list"}>["items"]
}>

const codeEditorStyle: CssStyle = css`
  & { width: 100%; height: 160px; min-height: 96px; }
`

const actionStyle: CssStyle = css`
  & { width: auto; min-width: 120px; min-height: 30px; padding: 5px 10px; align-self: flex-start; }
`

function MarkdownText(props: Readonly<{value: string}>) {
  return <span>{props.value}</span>
}

function MarkdownInlineCode(props: Readonly<{value: string}>) {
  return <code style={css`
    & { display: inline; color: var(--editor-content); font-family: monospace; }
  `}>{props.value}</code>
}

function MarkdownLink(props: Readonly<{value: string; href: string; external: boolean}>) {
  return <a
    href={props.href}
    rel={props.external ? "noreferrer" : undefined}
    style={css`& { display: inline; color: var(--widget-toolbar-content-selected); }`}
  >{props.value}</a>
}

function MarkdownInline(props: MarkdownInlineProps) {
  return <span data-markdown-inline={props.inline.kind}>
    {props.inline.kind === "text" ? <MarkdownText value={props.inline.value} /> : null}
    {props.inline.kind === "code" ? <MarkdownInlineCode value={props.inline.value} /> : null}
    {props.inline.kind === "link" ? <MarkdownLink
      value={props.inline.value}
      href={props.inline.href}
      external={props.inline.external}
    /> : null}
  </span>
}

function MarkdownInlineList(props: MarkdownInlineListProps) {
  return <span>{props.content.map(inline => <MarkdownInline key={inline.key} inline={inline} />)}</span>
}

function MarkdownHeading(props: Readonly<{
  level: number
  content: readonly StorybookMarkdownInline[]
}>) {
  return <h2
    role="heading"
    aria-level={String(props.level)}
    style={css`& { display: block; margin: 0 0 8px; color: var(--widget-regular-content); }`}
  ><MarkdownInlineList content={props.content} /></h2>
}

function MarkdownParagraph(props: MarkdownInlineListProps) {
  return <p style={css`& { display: block; margin: 0 0 8px; }`}>
    <MarkdownInlineList content={props.content} />
  </p>
}

function MarkdownListItem(props: Readonly<{
  item: Extract<StorybookMarkdownBlock, {kind: "list"}>["items"][number]
}>) {
  return <li><MarkdownInlineList content={props.item.content} /></li>
}

function MarkdownOrderedList(props: MarkdownListProps) {
  return <ol style={css`& { display: flex; flex-direction: column; margin: 0 0 8px; padding-left: 20px; }`}>
    {props.items.map(item => <MarkdownListItem key={item.key} item={item} />)}
  </ol>
}

function MarkdownUnorderedList(props: MarkdownListProps) {
  return <ul style={css`& { display: flex; flex-direction: column; margin: 0 0 8px; padding-left: 20px; }`}>
    {props.items.map(item => <MarkdownListItem key={item.key} item={item} />)}
  </ul>
}

function MarkdownList(props: Readonly<{
  ordered: boolean
  items: MarkdownListProps["items"]
}>) {
  return <section data-markdown-list={props.ordered ? "ordered" : "unordered"}>
    {props.ordered ? <MarkdownOrderedList items={props.items} /> : null}
    {!props.ordered ? <MarkdownUnorderedList items={props.items} /> : null}
  </section>
}

function MarkdownCodeBlock(props: Readonly<{languageId: string; value: string}>) {
  return <CodeEditor
    value={props.value}
    readOnly={true}
    languageId={props.languageId}
    title={`${props.languageId} code`}
    style={codeEditorStyle}
  />
}

function MarkdownBlock(props: MarkdownBlockProps) {
  const block = props.block
  return <section data-markdown-block={block.kind}>
    {block.kind === "heading" ? <MarkdownHeading level={block.level} content={block.content} /> : null}
    {block.kind === "paragraph" ? <MarkdownParagraph content={block.content} /> : null}
    {block.kind === "list" ? <MarkdownList ordered={block.ordered} items={block.items} /> : null}
    {block.kind === "code" ? <MarkdownCodeBlock languageId={block.languageId} value={block.value} /> : null}
  </section>
}

/** Compiled inert Markdown presentation with an optional production action. */
export function StorybookMarkdownView(props: StorybookMarkdownViewProps) {
  const onAction = (_event: Event) => props.action?.activate()
  return <article
    data-storybook-markdown=""
    style={css`
      & {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        padding: 12px;
        overflow-y: auto;
        color: var(--widget-box-content);
        font-size: var(--font-size-sm);
        line-height: 1.45;
      }
    `}
  >
    {props.markdown.blocks.map(block => <MarkdownBlock key={block.key} block={block} />)}
    {props.action === undefined ? null : <Button
      label={props.action.label}
      title={props.action.title}
      aria-label={props.action.title}
      tone="primary"
      style={actionStyle}
      onClick={onAction}
    />}
  </article>
}
