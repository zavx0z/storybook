import {Markdown} from "@zavx0z/immersive-markdown"
import formatJson from "@zavx0z/storybook-tech-json-format"
import {memo, useMemo} from "@zavx0z/immersive-component"
import {CodeEditor} from "@zavx0z/immersive-ui-component"
import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"
import {ChatNotice} from "./feedback"
import {serviceDocumentSource, serviceLanguageForMime} from "./service-document"

type Snapshot = Awaited<ReturnType<StorybookChatSession.Output["read"]>>
type Item = Snapshot["timeline"][number]
type Content = Extract<Item, {kind: "message"}>["content"][number]

function resourceMarkdown(block: Extract<Content, {type: "resource_link"}>): string {
  const label = (block.title ?? block.name).replace(/[\[\]\\]/gu, "\\$&")
  const uri = block.uri.replace(/[\s()]/gu, character => encodeURIComponent(character))
  return `[${label}](${uri})${block.description ? `\n\n${block.description}` : ""}`
}

/** Только штатное Markdown-представление; исходный текст и код не исполняются. */
export function ChatText(props: Readonly<{text: string}>) {
  return <Markdown
    source={props.text}
    wrap={true}
    style={css`
      width: 100%;
      min-width: 0;
      flex-shrink: 0;
      overflow-wrap: anywhere;
      font-size: 14px;
      line-height: 1.5;
    `}
  />
}

/** Изображение участвует в раскладке общего Document, без отдельного Canvas. */
function ChatImage(props: Readonly<{data: string, mimeType: string, label: string}>) {
  const supported = /^image\/[a-z0-9.+-]+$/iu.test(props.mimeType)
  return <div
    style={css`
      display: block;
      min-width: 0;
      max-width: 100%;
      flex-shrink: 0;
    `}
  >
    {supported ? <ChatImageData
      data={props.data}
      mimeType={props.mimeType}
      label={props.label}
    /> : null}
    {!supported ? <ChatNotice
      text={`Изображение: неподдерживаемый формат ${props.mimeType}`}
    /> : null}
  </div>
}

function ChatImageData(props: Readonly<{data: string, mimeType: string, label: string}>) {
  return <img
    data-chat-image=""
    src={`data:${props.mimeType};base64,${props.data}`}
    alt={props.label}
    style={css`
      display: block;
      max-width: 100%;
      height: auto;
      flex-shrink: 0;
    `}
  />
}

function ChatResource(props: Readonly<{content: Extract<Content, {type: "resource"}>}>) {
  const resource = props.content.resource
  return <section data-chat-resource={resource.uri}>
    <ChatText
      text={resource.uri}
    />
    {"text" in resource ? <ChatText
      text={resource.text}
    /> : null}
    {"blob" in resource && resource.mimeType?.startsWith("image/") ? <ChatImage
      data={resource.blob}
      mimeType={resource.mimeType}
      label={resource.uri}
    /> : null}
    {"blob" in resource && !resource.mimeType?.startsWith("image/") ? <ChatNotice
      text={`Бинарный ресурс · ${resource.mimeType ?? "неизвестный формат"}. Просмотр пока недоступен.`}
    /> : null}
  </section>
}

/** Переданные ресурсы не загружаются автоматически; бинарные данные не теряются в истории. */
export function ChatContent(props: Readonly<{content: Content}>) {
  const block = props.content
  return <div>
    {block.type === "text" ? <ChatText
      text={block.text}
    /> : null}
    {block.type === "image" ? <ChatImage
      data={block.data}
      mimeType={block.mimeType}
      label="Изображение в сообщении"
    /> : null}
    {block.type === "audio" ? <ChatNotice
      text={`Аудио · ${block.mimeType}. Воспроизведение в этом представлении пока недоступно.`}
      media="audio"
    /> : null}
    {block.type === "resource_link" ? <ChatText
      text={resourceMarkdown(block)}
    /> : null}
    {block.type === "resource" ? <ChatResource
      content={block}
    /> : null}
  </div>
}

/**
Служебное поле форматируется после монтирования раскрытых деталей.
Readonly CodeEditor сохраняет весь source; высота ограничивает viewport, но не число строк в DOM.
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
      style={css`
        width: 100%;
        max-width: 100%;
        min-width: 0;
        height: 240px;
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
function ChatContextResource(props: Readonly<{content: Extract<Content, {type: "resource"}>}>) {
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
    /> : null}
  </section>
}

/** Отдельная проекция только раскрытых служебных content; обычные сообщения сохраняют Markdown. */
export function ChatContextContent(props: Readonly<{content: Content, label?: string | undefined}>) {
  const block = props.content
  return <div>
    {block.type === "text" ? <ChatData
      label={props.label ?? "Контекст"}
      value={block.text}
    /> : null}
    {block.type === "resource" ? <ChatContextResource
      content={block}
    /> : null}
    {block.type !== "text" && block.type !== "resource" ? <ChatContent
      content={block}
    /> : null}
  </div>
}
