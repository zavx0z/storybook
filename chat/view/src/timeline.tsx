import {useMemo, useState} from "@zavx0z/immersive-component"
import {Panel} from "@zavx0z/immersive-ui-component"
import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"
import type {StorybookChatView} from "../contract"
import {ChatContent, ChatContextContent, ChatData} from "./content"
import {messageContent} from "./message-content"
import {EmptyHistory, ChatNotice} from "./feedback"

type Snapshot = Awaited<ReturnType<StorybookChatSession.Output["read"]>>
type Item = Snapshot["timeline"][number]
type Content = Extract<Item, {kind: "message"}>["content"][number]
type ToolContent = NonNullable<Extract<Item, {kind: "tool"}>["call"]["content"]>[number]

const toolStatuses: Readonly<Record<string, string>> = {
  pending: "Ожидание",
  in_progress: "Выполняется",
  completed: "Готово",
  failed: "Ошибка",
}
const eventLabels: Readonly<Record<string, string>> = {
  usage_update: "Контекстное окно",
  config_option_update: "Настройки исполнителя",
  current_mode_update: "Режим работы",
  available_commands_update: "Доступные команды",
  session_info_update: "Сведения о беседе",
}

function PlainTimelineText(props: Readonly<{text: string}>) {
  return <div data-chat-message-text="">
    {props.text}
  </div>
}

/** Ключ относится к compiled части сообщения; выбор содержимого находится внутри неё. */
function TimelineMessageContent(props: Readonly<{content: Content, user: boolean}>) {
  const content = props.content
  const plain = props.user && content.type === "text" && !/(?:^|\n)\s*(?:```|~~~)/u.test(content.text)
  return <div>
    {plain && content.type === "text" ? <PlainTimelineText
      text={content.text}
    /> : null}
    {!plain ? <ChatContent
      content={content}
    /> : null}
  </div>
}

/** Один compiled child выбирает штатное представление части результата инструмента. */
function TimelineToolContent(props: Readonly<{content: ToolContent}>) {
  const content = props.content
  return <div>
    {content.type === "content" ? <ChatContent
      content={content.content}
    /> : null}
    {content.type !== "content" ? <ChatData
      label={content.type === "diff" ? "Изменение файла" : "Терминал"}
      value={content}
    /> : null}
  </div>
}

function TimelineMessage(props: Readonly<{item: Extract<Item, {kind: "message"}>}>) {
  const user = props.item.role === "user"
  const blocks = useMemo(() => messageContent(props.item.content), [props.item.content])
  return <article
    data-chat-message={props.item.id}
    data-chat-role={props.item.role}
    aria-label={user ? "Ваше сообщение" : props.item.role === "system" ? "Состояние чата" : "Ответ агента"}
    style={css`
      display: flex;
      flex-direction: row;
      flex-shrink: 0;
      min-width: 0;
      width: 100%;
      line-height: 1.5;

      &[data-chat-role="user"] {
        justify-content: flex-end;
      }
    `}
  >
    <div
      data-chat-bubble={props.item.role}
      style={css`
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        width: 100%;
        min-width: 0;
        gap: 8px;
        padding: 4px 0;

        &[data-chat-bubble="user"] {
          width: fit-content;
          max-width: 90%;
          padding: 10px 14px;
          border-radius: 18px;
          background: rgb(var(--surface-750));
          color: var(--widget-regular-content);
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
      `}
    >
      {blocks.map((content, index) => <TimelineMessageContent
        key={index}
        content={content}
        user={user}
      />)}
      {props.item.diagnostic ? <ChatNotice
        text={props.item.diagnostic}
      /> : null}
    </div>
  </article>
}

function TimelineContentDetails(props: Readonly<{item: Extract<Item, {kind: "message" | "context"}>}>) {
  const item = props.item
  const blocks = useMemo(() => messageContent(item.content), [item.content])
  const service = item.kind === "context" || item.purpose === "command"
  const diagnostic = item.kind === "message" ? item.diagnostic : undefined
  return <div>
    {blocks.map((content, index) => <TimelineDetailContent
      key={index}
      content={content}
      service={service}
    />)}
    {diagnostic ? <ChatNotice
      text={diagnostic}
    /> : null}
  </div>
}

function TimelineDetailContent(props: Readonly<{content: Content, service: boolean}>) {
  return <div>
    {props.service ? <ChatContextContent
      content={props.content}
    /> : null}
    {!props.service ? <ChatContent
      content={props.content}
    /> : null}
  </div>
}

function TimelineToolDetails(props: Readonly<{item: Extract<Item, {kind: "tool"}>}>) {
  const item = props.item
  return <div>
    {(item.call.content ?? []).map((content, index) => <TimelineToolContent
      key={index}
      content={content}
    />)}
    {item.call.rawInput !== undefined ? <ChatData
      label="Аргументы"
      value={item.call.rawInput}
    /> : null}
    {item.call.rawOutput !== undefined ? <ChatData
      label="Результат"
      value={item.call.rawOutput}
    /> : null}
    <ChatData
      label="История вызова"
      value={item.updates}
    />
  </div>
}

function TimelineDetails(props: Readonly<{item: Item}>) {
  const item = props.item
  return <div data-chat-details="">
    {item.kind === "message" || item.kind === "context" ? <TimelineContentDetails
      item={item}
    /> : null}
    {item.kind === "tool" ? <TimelineToolDetails
      item={item}
    /> : null}
    {item.kind === "event" || item.kind === "turn" ? <ChatData
      label="Событие исполнителя"
      value={item.kind === "event" ? item.update : item}
    /> : null}
  </div>
}

function TimelineTurn(props: Readonly<{item: Extract<Item, {kind: "turn"}>}>) {
  const item = props.item
  const label = item.state === "started" ? "Выполнение началось" : item.state === "completed" ? "Выполнение завершено" : item.state === "cancelled" ? "Выполнение остановлено" : "Ошибка выполнения"
  const text = `${label}${item.stopReason ? ` · ${item.stopReason}` : ""}${item.error ? ` · ${item.error}` : ""}`
  return <p data-chat-turn={item.id} role="status">
    {text}
  </p>
}

/** Раскрытие принадлежит одной устойчивой compiled записи. */
function TimelineFoldedEntry(props: Readonly<{item: Exclude<Item, {kind: "turn"}>}>) {
  const [expanded, setExpanded] = useState(false)
  const item = props.item
  const label = item.kind === "tool" ? `${item.call.title ?? "Вызов инструмента"} · ${item.call.status ? toolStatuses[item.call.status] ?? "Состояние получено" : "Состояние не получено"}`
    : item.kind === "context" ? "Переданный контекст"
      : item.kind === "message" ? item.purpose === "command" ? "Команда среды" : "Рассуждение агента" : eventLabels[item.update.sessionUpdate] ?? "Событие исполнителя"
  return <section data-chat-entry={item.id} data-chat-kind={item.kind}>
    <Panel
      label={label}
      expanded={expanded}
      onToggle={value => setExpanded(value)}
    >
      {expanded ? <TimelineDetails item={item} /> : null}
    </Panel>
  </section>
}

/** Keyed запись сохраняет раскрытие при дополнении одного вызова или сообщения. */
function TimelineEntry(props: Readonly<{item: Item}>) {
  const item = props.item
  return <div
    style={css`
      display: flex;
      flex-direction: column;
      min-width: 0;
      width: 100%;
      flex-shrink: 0;
    `}
  >
    {item.kind === "message" && item.role !== "thought" && item.purpose !== "command" ? <TimelineMessage
      item={item}
    /> : null}
    {item.kind === "turn" ? <TimelineTurn
      item={item}
    /> : null}
    {item.kind !== "turn" && !(item.kind === "message" && item.role !== "thought" && item.purpose !== "command") ? <TimelineFoldedEntry
      item={item}
    /> : null}
  </div>
}

/** Legacy messages используются только при отсутствии timeline; явная пустая история сохраняется. */
export function ChatTimeline(props: Readonly<Pick<StorybookChatView.Input, "timeline" | "messages">>) {
  const timeline: readonly Item[] = props.timeline ?? props.messages.map((message, sequence) => ({
    ...message,
    kind: "message",
    sequence: sequence + 1,
    origin: "legacy",
    content: [{type: "text", text: message.text}],
  }))
  return <div
    data-chat-timeline=""
    style={css`
      display: flex;
      flex-direction: column;
      gap: 20px;
      min-width: 0;
      width: 100%;
      flex-shrink: 0;
    `}
  >
    {timeline.map(item => <TimelineEntry
      key={item.id}
      item={item}
    />)}
    {timeline.length === 0 ? <EmptyHistory /> : null}
  </div>
}
