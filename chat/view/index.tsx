/**
Чат предмета в общем Document Inspector: история событий, Markdown, медиа и компактный composer.
Модели, уровни мышления и заполнение контекста предоставляет владелец ACP-сессии.
Представление не запускает модель и не хранит историю или настройки агента.

@packageDocumentation
*/
import {useRef} from "@zavx0z/immersive-component"
import type {StorybookChatView as Contract} from "./contract"
import {ChatComposer} from "./src/composer"
import {ChatPermission, ChatStatus, ChatError} from "./src/feedback"
import {MediaOverlay} from "@zavx0z/chat/content"
import HistoryView from "@zavx0z/chat/history/view"
import {ChatTimeline} from "./src/timeline"

export type {StorybookChatView} from "./contract"

/** Управляемое поле сообщения: Enter отправляет, Shift+Enter переносит строку, IME не отправляет. */
export default function StorybookChatView(props: Contract.Input) {
  const heights = useRef<ReadonlyMap<string, number>>(new Map())
  const identity = `${props.address}:${props.executorId ?? ""}:${props.history.chatId ?? ""}`
  const pending = props.status === "connecting" || props.status === "running" || props.configuring === true && (props.settings?.length ?? 0) === 0
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
      onRowHeights={value => {heights.current = value}}
    >
      <ChatTimeline
        key={identity}
        view={props}
        heights={heights.current}
      />
      {pending ? <ChatStatus status={props.status} /> : null}
    </HistoryView>
    {props.error ? <ChatError error={props.error} /> : null}
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
