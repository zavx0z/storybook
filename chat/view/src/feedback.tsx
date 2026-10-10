import {useLayoutEffect, useRef, useState} from "@zavx0z/immersive/XReact"
import {Button} from "@zavx0z/immersive/ui"
import type {StorybookChatView as Contract} from "../contract"
import {permissionLabel} from "./permission-label"

export function ChatPermission(props: Readonly<{
  permission: NonNullable<Contract.Input["permissions"]>[number]
  onPermission: Contract.Input["onPermission"]
}>) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const pending = useRef(false)
  const alive = useRef(true)
  useLayoutEffect(() => {alive.current = true; return () => {alive.current = false}}, [])
  const choose = async (optionId: string) => {
    if (pending.current || !props.onPermission) return
    pending.current = true
    setSending(true)
    setError("")
    try { await props.onPermission(props.permission.id, optionId) }
    catch (failure) {if (alive.current) setError(failure instanceof Error ? failure.message : String(failure))}
    finally {pending.current = false; if (alive.current) setSending(false)}
  }
  const action = (props.permission.toolCall ?? props.permission.request?.toolCall)?.rawInput
  return <section
    data-chat-permission={props.permission.id}
    aria-label="Подтверждение действия"
    style={css`
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      min-height: 0;
      max-height: 45%;
      overflow-y: auto;
      gap: 10px;
      padding: 12px;
      border: 1px solid var(--widget-focus-outline);
      border-radius: 12px;
      background: rgb(var(--surface-800));
      color: var(--widget-regular-content);
    `}
  >
    <strong>Ожидает вашего подтверждения</strong>
    <p style={css`
      margin: 0;
      overflow-wrap: anywhere;
    `}>{props.permission.title}</p>
    {action !== undefined ? <PermissionAction value={action} /> : null}
    {props.permission.options.map(option => <PermissionOption
      key={option.id}
      option={option}
      disabled={sending || props.onPermission === undefined}
      onChoose={() => {void choose(option.id)}}
    />)}
    {sending ? <PermissionSending /> : null}
    {error ? <PermissionError text={error} /> : null}
  </section>
}


/** Весь input доступен в прокручиваемом тексте, без ellipsis и усечения команды. */
function PermissionAction(props: Readonly<{value: unknown}>) {
  const text = typeof props.value === "string" ? props.value : JSON.stringify(props.value, null, 2)
  return <pre
    data-permission-action=""
    style={css`
      box-sizing: border-box;
      margin: 0;
      padding: 8px;
      min-width: 0;
      max-width: 100%;
      max-height: 160px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: rgb(var(--surface-950));
      color: var(--widget-regular-content);
    `}
  >
    {text}
  </pre>
}

type Option = NonNullable<Contract.Input["permissions"]>[number]["options"][number]

/** kind определяет оформление; исходная подпись сохраняет точную область решения. */
function PermissionOption(props: Readonly<{option: Option, disabled: boolean, onChoose(): void}>) {
  const kind = props.option.kind
  const label = kind?.startsWith("allow") ? "Разрешить" : kind?.startsWith("reject") ? "Отклонить" : "Выбрать вариант"
  return <div
    data-permission-option={props.option.id}
    style={css`
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      min-width: 0;
      max-width: 100%;
    `}
  >
    <span
      data-permission-description=""
      title={props.option.name}
      style={css`
        display: block;
        max-width: 100%;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      `}
    >
      {permissionLabel(props.option.name)}
    </span>
    <Button
      label={label}
      aria-label={permissionLabel(props.option.name)}
      disabled={props.disabled}
      onClick={props.onChoose}
    />
  </div>
}

function PermissionSending() {
  return <span role="status">Отправляется решение…</span>
}

function PermissionError(props: Readonly<{text: string}>) {
  return <span
    role="alert"
    style={css`
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    `}
  >
    {props.text}
  </span>
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

export function ChatStatus(props: Readonly<{status: Contract.Input["status"], waiting?: boolean, activity?: Contract.Input["activity"]}>) {
  const label = props.activity === "cancelling" ? "Останавливается…" : props.waiting || props.activity === "waiting_for_approval" ? "Ожидает вашего подтверждения" : props.activity === "recovery_required" ? "Нужно восстановить выполнение" : props.status === "connecting" ? "Подключение…" : "Работает…"
  return <span
    role="status"
    data-chat-status={props.status}
  >
    {label}
  </span>
}

/** Старые записи без причины остаются честной ошибкой, а не англоязычным кодом. */
export function readableChatError(error: string): string {
  return /^(?:Чат: HTTP \d{3}:\s*)?Internal (?:server )?error$/iu.test(error.trim())
    ? "Выполнение не удалось. Если ошибка повторится, проверьте журнал среды"
    : error
}

export function ChatError(props: Readonly<{error: string, onRetrySettings?: (() => void) | undefined, retrying?: boolean | undefined}>) {
  return <div
    role="alert"
    data-chat-error=""
    style={css`
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      gap: 6px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    `}
  >
    <span>{readableChatError(props.error)}</span>
    {props.onRetrySettings ? <Button
      label="Повторить загрузку параметров"
      disabled={props.retrying}
      onClick={props.onRetrySettings}
    /> : null}
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
