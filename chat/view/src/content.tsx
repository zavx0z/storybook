import {Markdown} from "@zavx0z/immersive-markdown"
import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"
import {ChatNotice} from "./feedback"

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

/** Протокольные детали форматируются только при открытом разделе. */
export function ChatData(props: Readonly<{label: string, value: unknown}>) {
  const text = typeof props.value === "string" ? props.value : JSON.stringify(props.value, null, 2)
  return <section data-chat-data={props.label}>
    <strong>{props.label}</strong>
    <pre
      style={css`
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        min-width: 0;
      `}
    >
      {text}
    </pre>
  </section>
}
