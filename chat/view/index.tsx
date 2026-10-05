/**
Чат предмета в общем Document Inspector: история событий, Markdown, медиа и компактный composer.
Модели, уровни мышления и заполнение контекста предоставляет владелец ACP-сессии.
Представление не запускает модель и не хранит историю или настройки агента.

@packageDocumentation
*/
import {useLayoutEffect, useRef} from "@zavx0z/immersive-component"
import type {StorybookChatView as Contract} from "./contract"
import {ChatComposer} from "./src/composer"
import {ChatPermission, ChatStatus, ChatError} from "./src/feedback"
import {ChatTimeline} from "./src/timeline"

export type {StorybookChatView} from "./contract"

/** Управляемое поле сообщения: Enter отправляет, Shift+Enter переносит строку, IME не отправляет. */
export default function StorybookChatView(props: Contract.Input) {
  const end = useRef<HTMLElement | null>(null)
  const follow = useRef(true)
  const previousAddress = useRef(props.address)
  useLayoutEffect(() => {
    if (previousAddress.current !== props.address) {
      previousAddress.current = props.address
      follow.current = true
    }
    let active = true
    queueMicrotask(() => {
      if (active && follow.current) end.current?.scrollIntoView({block: "end", inline: "nearest"})
    })
    return () => { active = false }
  }, [props.timeline, props.messages, props.address])
  const pending = props.status === "connecting" || props.status === "running" || props.configuring === true && (props.settings?.length ?? 0) === 0
  return <section
    data-chat-view=""
    data-chat-address={props.address}
    aria-label={`Чат: ${props.label}`}
    style={css`
      box-sizing: border-box;
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
    <div
      role="log"
      aria-label="Сообщения"
      data-chat-messages=""
      onScroll={event => {
        if (!end.current) return
        follow.current = end.current.getBoundingClientRect().bottom - event.currentTarget.getBoundingClientRect().bottom < 24
      }}
      style={css`
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        flex-grow: 1;
        min-height: 0;
        min-width: 0;
        width: 100%;
        gap: 20px;
        padding: 12px 4px;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
      `}
    >
      <ChatTimeline
        key={props.address}
        timeline={props.timeline}
        messages={props.messages}
      />
      {pending ? <ChatStatus status={props.status} /> : null}
      <span
        ref={element => { end.current = element }}
        aria-hidden="true"
        style={css`
          display: block;
          flex-shrink: 0;
          width: 1px;
          height: 1px;
        `}
      />
    </div>
    {props.error ? <ChatError error={props.error} /> : null}
    {(props.permissions ?? []).map(permission => <ChatPermission
      key={permission.id}
      permission={permission}
      onPermission={props.onPermission}
    />)}
    <ChatComposer
      view={props}
    />
  </section>
}
