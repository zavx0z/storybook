import {Button} from "@zavx0z/immersive-ui-component"
import type {StorybookChatView as Contract} from "../contract"

export function ChatPermission(props: Readonly<{
  permission: NonNullable<Contract.Input["permissions"]>[number]
  onPermission: Contract.Input["onPermission"]
}>) {
  return <section
    data-chat-permission={props.permission.id}
    aria-label={props.permission.title}
    style={css`
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      gap: 6px;
    `}
  >
    <strong>{props.permission.title}</strong>
    <div
      style={css`
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        gap: 6px;
      `}
    >
      {props.permission.options.map(option => <Button
        key={option.id}
        label={option.name}
        disabled={props.onPermission === undefined}
        onClick={() => props.onPermission?.(props.permission.id, option.id)}
      />)}
    </div>
  </section>
}


export function EmptyHistory() {
  return <p
    style={css`
      color: var(--widget-text-content-readonly);
      white-space: normal;
      overflow-wrap: anywhere;
    `}
  >
    Напишите сообщение, чтобы начать беседу.
  </p>
}

export function ChatStatus(props: Readonly<{status: Contract.Input["status"]}>) {
  const label = props.status === "connecting" ? "Подключение…" : "Отвечает…"
  return <span
    role="status"
    data-chat-status={props.status}
  >
    {label}
  </span>
}

export function ChatError(props: Readonly<{error: string}>) {
  return <div
    role="alert"
    data-chat-error=""
    style={css`
      flex-shrink: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    `}
  >
    {props.error}
  </div>
}

/** Краткое состояние или ограничение переданного содержимого. */
export function ChatNotice(props: Readonly<{text: string, media?: string | undefined}>) {
  return <p
    role="status"
    data-chat-media={props.media}
  >
    {props.text}
  </p>
}
