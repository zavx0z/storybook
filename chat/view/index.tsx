/**
Чат предмета в общем Document Inspector: история событий, Markdown, медиа и компактный composer.
Модели, уровни мышления и заполнение контекста предоставляет владелец ACP-сессии.
Провайдер новой беседы выбирается до закрепления native identity. Смена модели
сбрасывает выбранное мышление; остальные настройки сохраняются.
Представление не запускает модель и не хранит историю или настройки агента.

@packageDocumentation
*/
import type {CompiledTemplate} from "@zavx0z/immersive-template/compiled"
import type {JSX} from "@zavx0z/immersive-jsx-compiler-session"

import {useRef, component, provideContext} from "@zavx0z/immersive-component"
import type {StorybookChatView as Contract} from "./contract"
import {ChatComposer} from "./src/composer"
import {ChatPermission, ChatStatus, ChatError} from "./src/feedback"
import Button from "@zavx0z/immersive-ui-component-button-basic"
import ConversationSurface from "@zavx0z/chat/surface"
import {MediaOverlay, MediaHostContext} from "@zavx0z/chat/content"
import HistoryView from "@zavx0z/chat/history/view"
import {ChatTimeline} from "./src/timeline"

export type {StorybookChatView} from "./contract"

type ChatContent = JSX.Element | readonly JSX.Element[] | null | undefined

/** Собирает общее представление беседы и контекст доставки медиа, не запуская исполнителя. */
export default function StorybookChatView(props: Contract.Input) {
  const content = renderChat(props)
  return <ChatHostContent>{content}</ChatHostContent>
}

/** Provider владеет только runtime context, разметка остаётся compiled ChatView. */
function renderChat(props: Contract.Input): ChatContent {
  return provideContext(MediaHostContext, props.mediaHost ?? null,
    component(ChatView as unknown as CompiledTemplate<Contract.Input>, props, "conversation")) as unknown as ChatContent
}

function ChatHostContent() {
  return <slot />
}

function ChatView(props: Contract.Input) {
  return <ConversationSurface label={`Чат: ${props.label}`}>
    <ChatViewContents view={props} />
  </ConversationSurface>
}

function ChatViewContents(input: Readonly<{view: Contract.Input}>) {
  const props = input.view
  const heights = useRef<ReadonlyMap<string, number>>(new Map())
  const identity = `${props.address}:${props.executorId ?? ""}:${props.history.chatId ?? ""}`
  const pending = props.status === "connecting" || props.status === "running"
  return <section
    data-chat-view=""
    data-chat-address={props.address}
    aria-label={`Чат: ${props.label}`}
    style={css`
      box-sizing: border-box;
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      gap: 12px;
      overflow: hidden;
      color: var(--widget-list-content);
      font-size: 14px;
    `}
  >
    <HistoryView
      identity={identity}
      history={props.history}
      onViewport={props.onHistoryViewport}
      onVisible={props.onHistoryVisible}
      onTail={props.onHistoryTail}
      onRetry={props.onHistoryRetryPage ?? (() => {})}
      onRowHeights={value => {heights.current = value}}
    >
      <ChatTimeline
        key={identity}
        view={props}
        heights={heights.current}
      />
      {pending ? <ChatStatus status={props.status} waiting={(props.permissions?.length ?? 0) > 0} activity={props.activity} /> : null}
    </HistoryView>
    {props.activity === "cancelling" && props.onStop ? <Button
      label="Завершить процесс исполнителя"
      title="Используйте, если обычная остановка не завершается"
      onClick={props.onStop}
    /> : null}
    {(props.pendingTasks ?? 0) > 0 ? <QueueStatus count={props.pendingTasks!} /> : null}
    {props.error ? <ChatError
      error={props.error}
      onRetrySettings={(props.status === "idle" || props.status === "failed") && (props.pendingTasks ?? 0) === 0 && !(props.settings ?? []).some(option => option.category === "model") ? props.onPrepareSettings : undefined}
      retrying={props.configuring}
    /> : null}
    {props.status === "failed" && (props.pendingTasks ?? 0) > 0 && props.onPrepareSettings ? <Button
      label="Повторить подключение и продолжить очередь"
      onClick={props.onPrepareSettings}
    /> : null}
    {(props.permissions ?? []).map(permission => <ChatPermission
      key={permission.id}
      permission={permission}
      onPermission={props.onPermission}
    />)}
    <ChatComposer
      view={props}
    />
    {props.media ? <MediaOverlay
      media={props.media}
      onClose={() => props.onMedia?.(null)}
    /> : null}
  </section>
}

function QueueStatus(props: Readonly<{count: number}>) {
  return <p role="status" style={css`
    margin: 0;
    font-size: 12px;
  `}>В очереди: {props.count}</p>
}
