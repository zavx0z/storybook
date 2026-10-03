/**
Чат предмета в общем Document Inspector: сообщения, Markdown и компактный composer.
Модели, уровни мышления и заполнение контекста предоставляет владелец ACP-сессии.
Представление не запускает модель и не хранит историю или настройки агента.

@packageDocumentation
*/
import {useLayoutEffect, useRef, useState} from "@zavx0z/component"
import {Button, IconButton, SelectField} from "@zavx0z/ui"
import svgIcon from "@ui-themes-icons/encode"
import {Markdown} from "@immersive/markdown"
import type {ChatView as Contract} from "./contract"

export type {ChatView} from "./contract"

const sendIcon = svgIcon('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 20V4m-7 7 7-7 7 7" fill="none" stroke="#161616" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')
const menuIcon = svgIcon('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="#aaa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>')
const stopIcon = svgIcon('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" fill="#161616"/></svg>')
const effortLabels: Readonly<Record<string, string>> = {
  none: "Без рассуждения", minimal: "Минимальное", low: "Низкое", medium: "Среднее",
  high: "Высокое", xhigh: "Очень высокое", max: "Максимальное", ultra: "Ультра",
}

function ChatMessage(props: Readonly<{message: Contract.Input["messages"][number]}>) {
  const user = props.message.role === "user"
  return <article
    data-chat-message={props.message.id}
    data-chat-role={props.message.role}
    aria-label={user ? "Ваше сообщение" : props.message.role === "system" ? "Состояние чата" : "Ответ агента"}
    style={css`
      box-sizing: border-box;
      display: flex;
      flex-direction: row;
      flex-shrink: 0;
      width: 100%;
      min-width: 0;
      line-height: 1.5;

      &[data-chat-role="user"] {
        justify-content: flex-end;
      }
    `}
  >
    {user && !/(?:^|\n)\s*(?:```|~~~)/u.test(props.message.text) ? <PlainMessage
      text={props.message.text}
    /> : <RichMessage message={props.message} />}
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


function PlainMessage(props: Readonly<{text: string}>) {
  return <div
    data-chat-bubble="user"
    data-chat-message-text=""
    style={css`
      box-sizing: border-box;
      width: fit-content;
      max-width: 90%;
      min-width: 0;
      padding: 10px 14px;
      border-radius: 18px;
      background: rgb(var(--surface-750));
      color: var(--widget-regular-content);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    `}
  >
    {props.text}
  </div>
}

function RichMessage(props: Readonly<{message: Contract.Input["messages"][number]}>) {
  return <div
    data-chat-bubble={props.message.role}
    style={css`
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      padding: 4px 0;

      &[data-chat-bubble="user"] {
        width: 90%;
        padding: 10px 14px;
        border-radius: 18px;
        background: rgb(var(--surface-750));
      }
    `}
  >
    <Markdown
      source={props.message.text}
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
  </div>
}

function EmptyHistory() {
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

function ChatStatus(props: Readonly<{status: Contract.Input["status"]}>) {
  const label = props.status === "connecting" ? "Подключение…" : "Отвечает…"
  return <span
    role="status"
    data-chat-status={props.status}
  >
    {label}
  </span>
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

function SettingsNotice(props: Readonly<{text: string}>) {
  return <span role="status">
    {props.text}
  </span>
}

function ChatSettings(props: Readonly<{
  settings: NonNullable<Contract.Input["settings"]>
  busy: boolean
  configuring: boolean
  progress?: string | undefined
  onConfigure: Contract.Input["onConfigure"]
}>) {
  return <section
    aria-label="Настройки модели"
    data-chat-settings=""
    style={css`
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      position: absolute;
      left: 0;
      right: 0;
      bottom: 100%;
      z-index: 10;
      flex-shrink: 0;
      width: 100%;
      gap: 8px;
      margin-bottom: 8px;
      padding: 12px;
      border: 1px solid var(--widget-regular-outline);
      border-radius: 12px;
      background: rgb(var(--surface-750));
    `}
  >
    {props.configuring ? <SettingsNotice text={props.progress ?? "Загрузка настроек…"} /> : null}
    {!props.configuring && props.settings.length === 0 ? <SettingsNotice text="Настройки пока недоступны" /> : null}
    {props.settings.map(option => <SelectField
      key={option.id}
      label={option.category === "model" ? "Модель" : "Мышление"}
      title={option.category === "model" ? "Модель" : "Уровень мышления"}
      value={option.value}
      options={option.options.map(item => ({
        key: item.value,
        value: item.value,
        label: option.category === "thought_level" ? effortLabels[item.value] ?? item.name : item.name,
        description: item.description,
      }))}
      disabled={props.busy || props.onConfigure === undefined}
      onChange={value => props.onConfigure?.(option.id, value)}
    />)}
  </section>
}

/** Кольцо показывает только полученные от агента used/size; отсутствие данных не равно нулю. */
function ContextIndicator(props: Readonly<{usage: Contract.Input["usage"]}>) {
  const usage = props.usage
  const percentage = usage ? Math.round(usage.used / usage.size * 100) : null
  const amount = (value: number) => value >= 1000 ? `${new Intl.NumberFormat("ru-RU", {maximumFractionDigits: 1}).format(value / 1000)} к` : String(value)
  const label = usage
    ? `Контекстное окно: ${percentage}% заполнено\nИспользовано ${amount(usage.used)} / ${amount(usage.size)} токенов`
    : "Контекстное окно: данные ещё не получены от агента"
  const length = 2 * Math.PI * 7
  const filled = length * Math.max(0, Math.min(100, percentage ?? 0)) / 100
  const icon = svgIcon(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="#555" stroke-width="2.5"/><circle cx="10" cy="10" r="7" fill="none" stroke="#ccc" stroke-width="2.5" stroke-dasharray="${filled} ${length}" transform="rotate(-90 10 10)"/></svg>`)
  return <span
    data-chat-context=""
    title={label}
    aria-label={label}
    role="img"
    tabIndex={0}
    style={css`
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 24px;
      height: 28px;
    `}
  >
    <img
      src={icon}
      width={20}
      height={20}
      alt=""
    />
  </span>
}

/** Управляемое поле сообщения: Enter отправляет, Shift+Enter переносит строку, IME не отправляет. */
export default function ChatView(props: Contract.Input) {
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
  }, [props.messages, props.address])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const pending = props.status === "connecting" || props.status === "running" || props.configuring === true && (props.settings?.length ?? 0) === 0
  const busy = pending || props.sending === true || props.configuring === true
  const canSend = !busy && props.draft.trim().length > 0
  const settings = props.settings ?? []
  const model = settings.find(option => option.category === "model")
  const effort = settings.find(option => option.category === "thought_level")
  const modelName = model?.options.find(option => option.value === model.value)?.name ?? model?.value ?? "Модель"
  const effortName = effort ? effortLabels[effort.value] ?? effort.options.find(option => option.value === effort.value)?.name ?? effort.value : ""
  const settingsLabel = `${modelName}${effortName ? ` · ${effortName}` : ""}`
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
      {props.messages.map(message => <ChatMessage
        key={message.id}
        message={message}
      />)}
      {props.messages.length === 0 ? <EmptyHistory /> : null}
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
    <div
      data-chat-composer=""
      style={css`
        box-sizing: border-box;
        position: relative;
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        min-width: 0;
        width: 100%;
        gap: 8px;
        padding: 12px;
        border: 1px solid var(--widget-regular-outline);
        border-radius: 20px;
        background: rgb(var(--surface-750));

        &:focus-within {
          border-color: var(--widget-focus-outline);
        }
      `}
    >
      {settingsOpen ? <ChatSettings
        settings={settings}
        busy={busy}
        configuring={props.configuring === true}
        progress={props.progress}
        onConfigure={props.onConfigure}
      /> : null}
      <textarea
        data-chat-input=""
        role="textbox"
        aria-multiline="true"
        aria-label="Сообщение"
        placeholder="Напишите сообщение…"
        value={props.draft}
        rows={Math.max(3, Math.min(12, props.draft.split("\n").length))}
        onFocus={() => setSettingsOpen(false)}
        onInput={event => props.onDraftChange(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return
          event.preventDefault()
          if (canSend && !event.repeat) props.onSend()
        }}
        style={css`
          box-sizing: border-box;
          display: block;
          width: 100%;
          min-width: 0;
          min-height: 72px;
          max-height: 180px;
          padding: 2px 0;
          border: 0;
          background: transparent;
          color: var(--widget-list-content);
          font-size: 14px;
          line-height: 1.5;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          overflow-x: hidden;
          overflow-y: auto;
        `}
      />
      <div
        style={css`
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
          min-width: 0;
          gap: 8px;
        `}
      >
        <div
          style={css`
            display: flex;
            flex-direction: row;
            align-items: center;
            min-width: 0;
            gap: 4px;
          `}
        >
          <ContextIndicator usage={props.usage} />
          <Button
            label={settingsLabel}
            endIcon={menuIcon}
            iconSize={12}
            title="Выбрать модель и уровень мышления"
            variant="text"
            aria-expanded={String(settingsOpen)}
            disabled={pending || props.sending === true || props.onPrepareSettings === undefined}
            onClick={() => {
              setSettingsOpen(!settingsOpen)
              if (!settingsOpen && settings.length === 0) props.onPrepareSettings?.()
            }}
            style={css`
              min-width: 0;
              max-width: 240px;
              padding: 2px 4px;
              border: 0;
              color: var(--widget-regular-content);
              font-size: 12px;
              white-space: nowrap;
            `}
          />
        </div>
        <IconButton
          label={pending ? "Остановить" : "Отправить"}
          title={pending ? "Остановить ответ" : "Отправить сообщение (Enter)"}
          iconSrc={pending ? stopIcon : sendIcon}
          iconSize={22}
          variant="contained"
          disabled={!pending && !canSend}
          onClick={() => {
            if (pending) props.onCancel()
            else if (canSend) props.onSend()
          }}
          style={css`
            flex-shrink: 0;
            width: 36px;
            height: 36px;
            min-height: 36px;
            padding: 0;
            border: 0;
            border-radius: 50%;
            background: #f5f5f5;
            color: #161616;
            --widget-hover-background: #ffffff;
            --widget-regular-background-selected: #dddddd;
            --widget-regular-content-selected: #161616;
          `}
        />
      </div>
    </div>
  </section>
}
