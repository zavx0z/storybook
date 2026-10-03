/**
Представление беседы у адресуемого предмета Storybook.
История, черновик, выполнение и решения пользователя принадлежат принимающему
владельцу сессии. Представление использует общий semantic Document Inspector.

@packageDocumentation
*/
import {Button, CodeEditor} from "@zavx0z/ui"
import type {ChatView as Contract} from "./contract"

export type {ChatView} from "./contract"

const statusLabels = {
  idle: "Готов",
  connecting: "Подключение…",
  running: "Отвечает…",
  failed: "Ошибка",
} as const

const roleLabels = {user: "Вы", assistant: "Codex", system: "Система"} as const

function EmptyChatHistory() {
  return <p>Напишите сообщение, чтобы начать беседу.</p>
}

function ChatError(props: Readonly<{error: string}>) {
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

function ChatMessage(props: Readonly<{message: Contract.Input["messages"][number]}>) {
  return <article
    data-chat-message={props.message.id}
    data-chat-role={props.message.role}
    style={css`
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      min-width: 0;
      gap: 4px;
    `}
  >
    <strong>{roleLabels[props.message.role]}</strong>
    <div
      data-chat-message-text=""
      style={css`
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      `}
    >
      {props.message.text}
    </div>
  </article>
}

function ChatPermission(props: Readonly<{
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

/**
Показывает переданный снимок беседы и передаёт действия владельцу сессии.
Редактор сохраняет возможность менять черновик во время ответа; отправка
доступна только вне выполнения и для текста с непробельными символами.
*/
export default function ChatView(props: Contract.Input) {
  const pending = props.status === "connecting" || props.status === "running"
  const canSend = !pending && props.sending !== true && props.draft.trim().length > 0
  const statusLabel = props.sending === true ? "Отправка сообщения…" : statusLabels[props.status]
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
      gap: 8px;
      overflow: hidden;
      color: var(--widget-list-content);
    `}
  >
    <header
      style={css`
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        gap: 4px;
      `}
    >
      <strong>{props.label}</strong>
      <span
        role="status"
        data-chat-status={props.status}
      >
        {statusLabel}
      </span>
    </header>
    <div
      role="log"
      aria-label="Сообщения"
      data-chat-messages=""
      style={css`
        display: flex;
        flex-direction: column;
        flex-grow: 1;
        min-height: 0;
        min-width: 0;
        gap: 12px;
        overflow-y: auto;
        scrollbar-width: thin;
      `}
    >
      {props.messages.map(message => <ChatMessage
        key={message.id}
        message={message}
      />)}
      {props.messages.length === 0 ? <EmptyChatHistory /> : null}
    </div>
    {props.error ? <ChatError error={props.error} /> : null}
    {(props.permissions ?? []).map(permission => <ChatPermission
      key={permission.id}
      permission={permission}
      onPermission={props.onPermission}
    />)}
    <div
      data-chat-composer=""
      style={css`
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        min-width: 0;
        gap: 6px;
      `}
    >
      <CodeEditor
        languageId="plaintext"
        showLineNumbers={false}
        readOnly={false}
        value={props.draft}
        title="Сообщение"
        onChange={props.onDraftChange}
        style={css`
          width: 100%;
          height: 120px;
          min-height: 80px;
          flex-shrink: 0;
        `}
      />
      <div
        style={css`
          display: flex;
          flex-direction: row;
          justify-content: flex-end;
          gap: 6px;
        `}
      >
        <Button
          label="Остановить"
          disabled={!pending}
          onClick={() => {
            if (pending) props.onCancel()
          }}
        />
        <Button
          label="Отправить"
          disabled={!canSend}
          onClick={() => {
            if (canSend) props.onSend()
          }}
        />
      </div>
    </div>
  </section>
}
