import MessageView, {type MediaPreview} from "@zavx0z/chat/content"
import formatJson from "@zavx0z/storybook-tech-json-format"
import {memo, useMemo} from "@zavx0z/immersive/XReact"
import {CodeEditor} from "@zavx0z/immersive/ui"
import type {StorybookChatHistory} from "@zavx0z/storybook-chat-history"
import {ChatNotice} from "./feedback"
import {serviceDocumentSource, serviceLanguageForMime} from "./service-document"

type Item = StorybookChatHistory.Output[number]
type Content = Extract<Item, {kind: "message"}>["content"][number]

/** Блоки сообщения отображаются reusable Chat frontend; ACP остаётся у host. */
export function ChatText(props: Readonly<{text: string}>) {
  return <MessageView content={{type: "text", text: props.text}} />
}

export function ChatContent(props: Readonly<{content: Content, plain?: boolean | undefined, onMedia?: ((media: MediaPreview) => void) | undefined}>) {
  return <MessageView content={props.content} plain={props.plain} onMedia={props.onMedia} />
}

/**
Служебное поле форматируется после монтирования раскрытых деталей.
Readonly CodeEditor сохраняет source одного resident тела и штатно ограничивает окно больших документов.
Typed value сериализуется один раз; неизменный source переиспользует форматирование и токенизацию.
*/
function ChatDataView(props: Readonly<{
  label: string
  value: unknown
  languageId?: string | undefined
  path?: string | undefined
}>) {
  const source = useMemo(() => serviceDocumentSource(props.value), [props.value])
  const document = useMemo(() => formatJson(source), [source])
  const languageId = props.languageId ?? (props.path === undefined ? document.languageId : undefined)
  return <section
    data-chat-data={props.label}
    style={css`
      display: flex;
      flex-direction: column;
      width: 100%;
      min-width: 0;
      flex-shrink: 0;
      gap: 4px;
    `}
  >
    <strong>{props.label}</strong>
    <CodeEditor
      title={props.label}
      value={document.text}
      languageId={languageId}
      path={props.path}
      readOnly={true}
      showLineNumbers={false}
      softBreaks={document.softBreaks}
      showFormattingCharacters={false}
      style={css`
        width: 100%;
        max-width: 100%;
        min-width: 0;
        height: auto;
        max-height: 240px;
        overflow: auto;
        flex-shrink: 0;
        user-select: contain;
      `}
    />
  </section>
}

export const ChatData = memo(ChatDataView)

/** Исходник embedded resource использует его URI/MIME, не интерпретируя произвольный ACP metadata. */
function ChatContextResource(props: Readonly<{content: Extract<Content, {type: "resource"}>, onMedia?: ((media: MediaPreview) => void) | undefined}>) {
  const resource = props.content.resource
  return <section
    data-chat-resource={resource.uri}
    data-chat-mime-type={resource.mimeType ?? undefined}
  >
    {"text" in resource ? <ChatData
      label={resource.uri}
      value={resource.text}
      languageId={serviceLanguageForMime(resource.mimeType)}
      path={resource.uri}
    /> : null}
    {"blob" in resource ? <ChatContent
      content={props.content}
      onMedia={props.onMedia}
    /> : null}
  </section>
}

/** Отдельная проекция только раскрытых служебных content; обычные сообщения сохраняют Markdown. */
export function ChatContextContent(props: Readonly<{content: Content, label?: string | undefined, onMedia?: ((media: MediaPreview) => void) | undefined}>) {
  const block = props.content
  return <div>
    {block.type === "text" ? <ChatData
      label={props.label ?? "Контекст"}
      value={block.text}
    /> : null}
    {block.type === "resource" ? <ChatContextResource
      content={block}
      onMedia={props.onMedia}
    /> : null}
    {block.type !== "text" && block.type !== "resource" ? <ChatContent
      content={block}
      onMedia={props.onMedia}
    /> : null}
  </div>
}
