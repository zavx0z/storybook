import {useState} from "@zavx0z/immersive-component"
import {Button, IconButton} from "@zavx0z/immersive-ui-component"
import svgIcon from "@zavx0z/immersive-tech-svg-encode"
import {ChatSettings, ContextIndicator, effortLabels} from "./settings"
import {ChatExecutors} from "./executors"
import type {StorybookChatView as Contract} from "../contract"

const sendIcon = svgIcon('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 20V4m-7 7 7-7 7 7" fill="none" stroke="#161616" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')
const menuIcon = svgIcon('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="#aaa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>')
const stopIcon = svgIcon('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" fill="#161616"/></svg>')

/** Отправка и клавиатура используют стандартные события textarea общего Document. */
export function ChatComposer(input: Readonly<{view: Contract.Input}>) {
  const props = input.view
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const pending = props.status === "connecting" || props.status === "running" || props.configuring === true && (props.settings?.length ?? 0) === 0
  const busy = pending || props.sending === true || props.configuring === true
  const canSend = !busy && props.draft.trim().length > 0
  const settings = props.settings ?? []
  const model = settings.find(option => option.category === "model")
  const effort = settings.find(option => option.category === "thought_level")
  const modelName = model?.options.find(option => option.value === model.value)?.name ?? model?.value ?? "Модель"
  const effortName = effort ? effortLabels[effort.value] ?? effort.options.find(option => option.value === effort.value)?.name ?? effort.value : ""
  const settingsLabel = `${modelName}${effortName ? ` · ${effortName}` : ""}`
  return <div
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
    {props.executors !== undefined ? <ChatExecutors
      key={props.address}
      view={props}
    /> : null}
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
      placeholder={focused || props.draft.length > 0 ? "" : "Напишите сообщение…"}
      value={props.draft}
      rows={Math.max(3, Math.min(12, props.draft.split("\n").length))}
      onFocus={() => {
        setFocused(true)
        setSettingsOpen(false)
      }}
      onBlur={() => setFocused(false)}
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
}
