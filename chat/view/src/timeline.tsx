import type {MediaPreview} from "@zavx0z/chat/content"
import {useMemo} from "@zavx0z/immersive-component"
import Panel from "@zavx0z/immersive-ui-component-surface-panel"
import type {StorybookChatHistory} from "@zavx0z/storybook-chat-history"
import type {StorybookChatView} from "../contract"
import {ChatContent, ChatContextContent, ChatData} from "./content"
import {messageContent} from "./message-content"
import {EmptyHistory, ChatNotice} from "./feedback"

type Item = StorybookChatHistory.Output[number]
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

function TimelineMessage(props: Readonly<{item: Extract<Item, {kind: "message"}>, onMedia?: ((media: MediaPreview) => void) | undefined}>) {
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
        onMedia={props.onMedia}
        user={user}
      />)}
      {props.item.diagnostic ? <ChatNotice
        text={props.item.diagnostic}
      /> : null}
    </div>
  </article>
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

function TimelineToolDetails(props: Readonly<{item: Extract<Item, {kind: "tool"}>, onMedia?: ((media: MediaPreview) => void) | undefined}>) {
  const item = props.item
  return <div>
    {(item.call.content ?? []).map((content, index) => <TimelineToolContent
      key={index}
      content={content}
      onMedia={props.onMedia}
    />)}
    {item.call.rawInput !== undefined ? <ChatData
      label="Аргументы"
      value={item.call.rawInput}
    /> : null}
    {item.call.rawOutput !== undefined ? <ChatData
      label="Результат"
      value={item.call.rawOutput}
    /> : null}

  </div>
}

function TimelineDetails(props: Readonly<{item: Item, onMedia?: ((media: MediaPreview) => void) | undefined}>) {
  const item = props.item
  return <div data-chat-details="">
    {item.kind === "message" || item.kind === "context" ? <TimelineContentDetails
      item={item}
      onMedia={props.onMedia}
    /> : null}
    {item.kind === "tool" ? <TimelineToolDetails
      item={item}
      onMedia={props.onMedia}
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

/** Заголовок сохраняется без тела; раскрытие вызывает явное lazy действие владельца. */
function TimelineFoldedEntry(props: Readonly<{row: StorybookChatView.Input["history"]["rows"][number], view: StorybookChatView.Input}>) {
  const row = props.row
  const header = row.header
  const label = header.kind === "tool" ? `${header.title ?? "Вызов инструмента"} · ${header.status ? toolStatuses[header.status] ?? "Состояние получено" : "Состояние не получено"}`
    : header.kind === "context" ? "Переданный контекст"
      : header.kind === "message" ? header.purpose === "command" ? "Команда среды" : "Рассуждение агента" : header.title ?? "Событие исполнителя"
  return <section data-chat-entry={header.id} data-chat-kind={header.kind}>
    <Panel
      label={label}
      expanded={row.expanded}
      onToggle={value => props.view.onHistoryExpand(header.id, value)}
    >
      {row.expanded ? <LazyDetails
        row={row}
        view={props.view}
      /> : null}
    </Panel>
  </section>
}

function MissingBody(props: Readonly<{row: StorybookChatView.Input["history"]["rows"][number], view: StorybookChatView.Input}>) {
  const statusText = props.row.loading ? "Загрузка записи…" : props.row.error ?? "Содержимое выгружено"
  return <div data-chat-body-placeholder="">
    {statusText}
    {!props.row.loading ? <ReloadBody
      id={props.row.header.id}
      onRetry={props.view.onHistoryRetry}
    /> : null}
  </div>
}

function LazyDetails(props: Readonly<{row: StorybookChatView.Input["history"]["rows"][number], view: StorybookChatView.Input}>) {
  const row = props.row
  return <div>
    {row.body ? <TimelineDetails item={row.body} onMedia={props.view.onMedia} /> : <MissingBody row={row} view={props.view} />}
    {row.body && row.header.evidenceCount > 0 ? <EvidenceDetails
      row={row}
      view={props.view}
    /> : null}
  </div>
}

/** Только resident заголовки и body текущего viewport; скрытые подробности не создаются. */
function TimelineEntry(props: Readonly<{row: StorybookChatView.Input["history"]["rows"][number], view: StorybookChatView.Input, height: number}>) {
  const {row, view} = props
  const header = row.header
  const message = header.kind === "message" && header.role !== "thought" && header.purpose !== "command"
  const minimumHeight = row.body || !message && !row.expanded ? 48 : props.height
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
    {message && row.body?.kind === "message" ? <TimelineMessage item={row.body} onMedia={view.onMedia} /> : null}
    {message && !row.body ? <MissingBody row={row} view={view} /> : null}
    {header.kind === "turn" ? <TurnHeader row={row} /> : null}
    {!message && header.kind !== "turn" ? <TimelineFoldedEntry row={row} view={view} /> : null}
    {header.origin === "replay" ? <ChatNotice text="Восстановлено из сессии исполнителя" /> : null}
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
  return <button type="button" onClick={() => props.onRetry(props.id)}>Загрузить запись</button>
}

function TurnHeader(props: Readonly<{row: StorybookChatView.Input["history"]["rows"][number]}>) {
  const header = props.row.header
  const label = header.state === "completed" ? "Выполнение завершено" : header.state === "started" ? "Выполнение началось" : header.state === "cancelled" ? "Выполнение остановлено" : header.error ?? "Ошибка выполнения"
  return <p data-chat-turn={header.id} role="status">
    {label}
  </p>
}

function EvidenceDetails(props: Readonly<{row: StorybookChatView.Input["history"]["rows"][number], view: StorybookChatView.Input}>) {
  const row = props.row
  return <section data-chat-evidence="">
    <button
      type="button"
      disabled={row.loading}
      onClick={() => props.view.onHistoryEvidence(row.header.id)}
    >Получить свидетельства ({row.header.evidenceCount})</button>
    {row.evidence ? <ChatData
      label="История вызова"
      value={row.evidence.items}
    /> : null}
    {row.evidence?.after != null ? <EvidenceNext row={row} view={props.view} /> : null}
  </section>
}

function EvidenceNext(props: Readonly<{row: StorybookChatView.Input["history"]["rows"][number], view: StorybookChatView.Input}>) {
  return <button
    type="button"
    disabled={props.row.loading}
    onClick={() => props.view.onHistoryEvidence(props.row.header.id, props.row.evidence!.after!)}
  >Следующая страница свидетельств</button>
}
