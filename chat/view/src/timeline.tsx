import ToolTerminal from "./terminal-output-view"
import {readTerminalOutput} from "./terminal-output"
import type {MediaPreview} from "@zavx0z/chat/content"
import {useMemo} from "@zavx0z/immersive-component"
import MessageBubble from "@zavx0z/chat/bubble"
import Button from "@zavx0z/immersive-ui-component-button-basic"
import Panel from "@zavx0z/immersive-ui-component-surface-panel"
import type {StorybookChatHistory} from "@zavx0z/storybook-chat-history"
import type {StorybookChatView} from "../contract"
import ServiceGroup, {ContentFragments, DetailFragments} from "./service-group"
import type {DisplayBody} from "../contract/history"
import {ChatContent, ChatContextContent, ChatData} from "./content"
import {messageContent} from "./message-content"
import {EmptyHistory, ChatNotice, readableChatError} from "./feedback"

type Item = StorybookChatHistory.Output[number]
type Content = Extract<Item, {kind: "message"}>["content"][number]
type ToolContent = NonNullable<Extract<Item, {kind: "tool"}>["call"]["content"]>[number]

const toolStatuses: Readonly<Record<string, string>> = {
  pending: "Ожидание",
  in_progress: "Выполняется",
  completed: "Готово",
  failed: "Ошибка",
  started: "Выполняется",
  cancelled: "Остановлено",
  requested: "Ожидает решения",
  decided: "Решение сохранено",
  interrupted: "Прервано",
}
const eventLabels: Readonly<Record<string, string>> = {
  usage_update: "Контекстное окно",
  config_option_update: "Настройки исполнителя",
  current_mode_update: "Режим работы",
  available_commands_update: "Доступные команды",
  session_info_update: "Сведения о беседе",
}

/** Host решает plain/Markdown; сами блоки отображает reusable Chat. */
function TimelineMessageContent(props: Readonly<{content: Content, user: boolean, onMedia?: ((media: MediaPreview) => void) | undefined}>) {
  const plain = props.user && props.content.type === "text" && !/(?:^|\n)\s*(?:```|~~~)/u.test(props.content.text)
  return <ChatContent content={props.content} plain={plain} onMedia={props.onMedia} />
}

/** Один compiled child выбирает штатное представление части результата инструмента. */
function TimelineToolContent(props: Readonly<{content: ToolContent, onMedia?: ((media: MediaPreview) => void) | undefined}>) {
  const content = props.content
  return <div>
    {content.type === "content" ? <ChatContent
      content={content.content}
      onMedia={props.onMedia}
    /> : null}
    {content.type !== "content" ? <ChatData
      label={content.type === "diff" ? "Изменение файла" : "Терминал"}
      value={content}
    /> : null}
  </div>
}

function TimelineMessage(props: Readonly<{item: Extract<DisplayBody, {kind: "message"}>, onMedia?: ((media: MediaPreview) => void) | undefined, onCopyText?: ((text: string) => Promise<void>) | undefined, onCopyMessage?: ((id: string) => Promise<void>) | undefined}>) {
  const user = props.item.role === "user" && props.item.authorship !== "unresolved"
  const blocks = useMemo(() => messageContent(props.item.content), [props.item.content])
  const source = blocks.flatMap(block => block.type === "text" ? [block.text] : []).join("")
  return <div data-chat-message={props.item.id} data-chat-role={props.item.role}>
    <MessageBubble
      id={props.item.id}
      own={user}
      label={props.item.authorship === "unresolved" ? "Сообщение из истории исполнителя"
        : user ? "Ваше сообщение" : props.item.role === "system" ? "Состояние чата" : "Ответ агента"}
      receivedAt={props.item.receivedAt}
      onCopy={source && !props.item.continuation && !props.item.copyRequiresSource && props.onCopyText ? () => props.onCopyText!(source)
        : source && props.onCopyMessage ? () => props.onCopyMessage!(props.item.id) : undefined}
    >
      {blocks.map((content, index) => <TimelineMessageContent
        key={index}
        content={content}
        onMedia={props.onMedia}
        user={user}
      />)}
      {props.item.authorship === "unresolved" ? <ChatNotice text="Автор сообщения не установлен" /> : null}
      {props.item.authorship !== "unresolved" && props.item.diagnostic ? <ChatNotice text={props.item.diagnostic} /> : null}
    </MessageBubble>
  </div>
}

function TimelineContentDetails(props: Readonly<{item: Extract<Item, {kind: "message" | "context"}>, onMedia?: ((media: MediaPreview) => void) | undefined}>) {
  const item = props.item
  const blocks = useMemo(() => messageContent(item.content), [item.content])
  const service = item.kind === "context" || item.purpose === "command"
  const diagnostic = item.kind === "message" ? item.diagnostic : undefined
  return <div>
    {blocks.map((content, index) => <TimelineDetailContent
      key={index}
      content={content}
      onMedia={props.onMedia}
      service={service}
    />)}
    {diagnostic ? <ChatNotice
      text={diagnostic}
    /> : null}
  </div>
}

function TimelineDetailContent(props: Readonly<{content: Content, service: boolean, onMedia?: ((media: MediaPreview) => void) | undefined}>) {
  return <div>
    {props.service ? <ChatContextContent
      content={props.content}
      onMedia={props.onMedia}
    /> : null}
    {!props.service ? <ChatContent
      content={props.content}
      onMedia={props.onMedia}
    /> : null}
  </div>
}

function TimelineToolDetails(props: Readonly<{item: Extract<DisplayBody, {kind: "tool"}>, view: StorybookChatView.Input, onMedia?: ((media: MediaPreview) => void) | undefined}>) {
  const item = props.item
  const terminal = readTerminalOutput(item.call)
  return <div>
    {(item.call.content ?? []).filter(content => content.type !== "terminal").map((content, index) => <TimelineToolContent
      key={index}
      content={content}
      onMedia={props.onMedia}
    />)}
    {item.call.rawInput !== undefined ? <ChatData
      label="Аргументы"
      value={item.call.rawInput}
    /> : null}
    {terminal.known || item.terminal ? <ToolTerminal
      id={item.terminal?.id ?? item.id}
      call={item.call}
      terminal={item.terminal}
      read={props.view.readHistoryTerminal}
    /> : null}
    {item.call.rawOutput !== undefined && !terminal.known && !item.terminal ? <ChatData
      label="Результат"
      value={item.call.rawOutput}
    /> : null}

  </div>
}

function TimelineDetails(props: Readonly<{item: Item, view: StorybookChatView.Input, onMedia?: ((media: MediaPreview) => void) | undefined}>) {
  const item = props.item
  return <div data-chat-details="">
    {item.kind === "message" || item.kind === "context" ? <TimelineContentDetails
      item={item}
      onMedia={props.onMedia}
    /> : null}
    {item.kind === "tool" ? <TimelineToolDetails
      view={props.view}
      item={item}
      onMedia={props.onMedia}
    /> : null}
    {item.kind === "event" || item.kind === "turn" || item.kind === "permission" ? <ChatData
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

/** Заголовок сохраняется без тела; раскрытие вызывает явное lazy действие владельца. */
function TimelineFoldedEntry(props: Readonly<{row: StorybookChatView.Input["history"]["rows"][number], view: StorybookChatView.Input}>) {
  const row = props.row
  const header = row.header
  const label = header.kind === "tool" ? `${header.title ?? "Вызов инструмента"} · ${header.status ? toolStatuses[header.status] ?? "Состояние получено" : "Состояние не получено"}`
    : header.kind === "group" ? `Действия агента · ${header.memberCount}${header.status ? ` · ${toolStatuses[header.status] ?? header.status}` : ""}`
      : header.kind === "permission" ? `${header.title ?? "Подтверждение действия"} · ${toolStatuses[header.phase ?? ""] ?? "Решение"}`
      : header.kind === "event" ? eventLabels[header.eventType ?? ""] ?? "Событие исполнителя"
      : header.kind === "context" ? "Переданный контекст"
      : header.kind === "message" ? header.purpose === "command" ? "Команда среды" : "Рассуждение агента" : header.title ?? "Событие исполнителя"
  return <section data-chat-entry={header.id} data-chat-kind={header.kind}>
    <Panel
      label={label}
      expanded={row.expanded}
      onToggle={value => props.view.onHistoryExpand(header.id, value)}
    >
      {row.expanded && header.kind === "group" ? <ServiceGroup group={header} view={props.view} /> : null}
      {row.expanded && header.kind !== "group" ? <LazyDetails row={row} view={props.view} /> : null}
    </Panel>
  </section>
}

function MissingBody(props: Readonly<{row: StorybookChatView.Input["history"]["rows"][number], view: StorybookChatView.Input}>) {
  const statusText = props.row.loading ? "Загрузка записи…" : props.row.error ?? "Загрузка записи…"
  return <div data-chat-body-placeholder="">
    {statusText}
    {props.row.error ? <ReloadBody
      id={props.row.header.id}
      onRetry={props.view.onHistoryRetry}
    /> : null}
  </div>
}

function LazyDetails(props: Readonly<{row: StorybookChatView.Input["history"]["rows"][number], view: StorybookChatView.Input}>) {
  const row = props.row
  return <div>
    {row.body && row.body.kind !== "group" && row.body.kind !== "detail" ? <TimelineDetails item={row.body as Item} view={props.view} onMedia={props.view.onMedia} /> : null}
    {row.body?.kind === "detail" ? <DetailFragments body={row.body} view={props.view} /> : null}
    {!row.body ? <MissingBody row={row} view={props.view} /> : null}
    {row.body && (row.body.kind === "message" || row.body.kind === "context") && row.body.continuation ? <ContentFragments id={"entryId" in row.header ? row.header.entryId : row.header.id} body={row.body} view={props.view} /> : null}
    {row.body && row.header.evidenceCount > 0 ? <EvidenceDetails
      row={row}
      view={props.view}
    /> : null}
  </div>
}

/** Малые сообщения сохраняют DOM в пределах resident страниц; подробности читаются по раскрытию. */
function TimelineEntry(props: Readonly<{row: StorybookChatView.Input["history"]["rows"][number], view: StorybookChatView.Input, height: number}>) {
  const {row, view} = props
  const header = row.header
  const message = header.kind === "message" && header.role !== "thought" && header.purpose !== "command"
  const minimumHeight = row.body || !message && !row.expanded ? 0 : props.height
  return <div
    data-chat-history-id={header.id}
    data-chat-ordinal={header.ordinal}
    data-chat-origin={header.origin}
    style={css`
      display: flex;
      flex-direction: column;
      min-width: 0;
      width: 100%;
      min-height: ${minimumHeight}px;
      flex-shrink: 0;
    `}
  >
    {message && row.body?.kind === "message" ? <TimelineMessage item={row.body} onMedia={view.onMedia} onCopyText={view.onCopyText} onCopyMessage={view.onCopyMessage} /> : null}
    {message && !row.body ? <MissingBody row={row} view={view} /> : null}
    {message && row.body?.kind === "message" && row.body.continuation ? <ContentFragments id={header.id} body={row.body} view={view} /> : null}
    {header.kind === "turn" ? <TurnHeader row={row} /> : null}
    {!message && header.kind !== "turn" ? <TimelineFoldedEntry row={row} view={view} /> : null}
  </div>
}

/** Полная timeline и legacy messages здесь не принимаются. */
export function ChatTimeline(props: Readonly<{view: StorybookChatView.Input, heights?: ReadonlyMap<string, number>}>) {
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
    {props.view.history.rows.map(row => <TimelineEntry
      key={row.header.id}
      row={row}
      view={props.view}
      height={props.heights?.get(row.header.id) ?? 48}
    />)}
    {props.view.history.total === 0 && !props.view.history.loading ? <EmptyHistory /> : null}
  </div>
}

function ReloadBody(props: Readonly<{id: string, onRetry(id: string): void}>) {
  return <Button label="Повторить загрузку" onClick={() => props.onRetry(props.id)} />
}

function TurnHeader(props: Readonly<{row: StorybookChatView.Input["history"]["rows"][number]}>) {
  const header = props.row.header
  const turn = header.kind === "turn" ? header : undefined
  const label = turn?.state === "completed" ? "Выполнение завершено" : turn?.state === "started" ? "Выполнение началось" : turn?.state === "cancelled" ? "Выполнение остановлено" : readableChatError(turn?.error ?? "Ошибка выполнения")
  return <p data-chat-turn={header.id} role="status">
    {label}
  </p>
}

function EvidenceDetails(props: Readonly<{row: StorybookChatView.Input["history"]["rows"][number], view: StorybookChatView.Input}>) {
  const row = props.row
  return <section data-chat-evidence="">
    <Button
      label={`Подробности · ${row.header.evidenceCount} событий`}
      disabled={row.loading}
      onClick={() => props.view.onHistoryEvidence(row.header.id)}
    />
    {row.evidence ? <ChatData
      label="История вызова"
      value={row.evidence.items}
    /> : null}
    {row.evidence?.after != null ? <EvidenceNext row={row} view={props.view} /> : null}
  </section>
}

function EvidenceNext(props: Readonly<{row: StorybookChatView.Input["history"]["rows"][number], view: StorybookChatView.Input}>) {
  return <Button
    label="Следующие события"
    disabled={props.row.loading}
    onClick={() => props.view.onHistoryEvidence(props.row.header.id, props.row.evidence!.after!)}
  />
}
