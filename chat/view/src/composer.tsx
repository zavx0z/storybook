import {useState} from "@zavx0z/immersive-component"
import Button from "@zavx0z/immersive-ui-component-button-basic"
import Composer from "@zavx0z/chat/composer"
import svgIcon from "@zavx0z/immersive-tech-svg-encode"
import {ChatSettings, ContextIndicator, effortLabels} from "./settings"
import type {StorybookChatView as Contract} from "../contract"

const menuIcon = svgIcon('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="#aaa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>')
export function ChatComposer(input: Readonly<{view: Contract.Input}>) {
  const props = input.view
  const [settingsOpen, setSettingsOpen] = useState(false)
  const pending = props.status === "connecting" || props.status === "running" || props.configuring === true && (props.settings?.length ?? 0) === 0
  const busy = pending || props.sending === true || props.configuring === true || props.attaching === true
  const settings = props.settings ?? []
  const model = settings.find(option => option.category === "model")
  const effort = settings.find(option => option.category === "thought_level")
  const modelName = model?.options.find(option => option.value === model.value)?.name ?? model?.value ?? "Модель"
  const effortName = effort ? effortLabels[effort.value] ?? effort.options.find(option => option.value === effort.value)?.name ?? effort.value : ""
  const settingsLabel = `${modelName}${effortName ? ` · ${effortName}` : ""}`
  return <div>
    {settingsOpen ? <ChatSettings
      settings={settings}
      busy={busy}
      configuring={props.configuring === true}
      progress={props.progress}
      onConfigure={props.onConfigure}
    /> : null}
    <Composer
      draft={props.draft}
      busy={busy}
      canCancel={props.status === "connecting" || props.status === "running"}
      onDraftChange={props.onDraftChange}
      onSend={props.onSend}
      onCancel={props.onCancel}
      onFocus={() => setSettingsOpen(false)}
      attachments={props.attachments}
      onAttach={props.onAttach}
      onRemove={props.onRemoveAttachment}
      onPreview={attachment => props.onMedia?.({source: attachment.attachment, mimeType: attachment.attachment.mimeType, label: attachment.attachment.name})}
    >
      <ChatModelControls
        usage={props.usage}
        label={settingsLabel}
        expanded={settingsOpen}
        disabled={pending || props.sending === true || props.onPrepareSettings === undefined}
        onToggle={() => {
          setSettingsOpen(!settingsOpen)
          if (!settingsOpen && settings.length === 0) props.onPrepareSettings?.()
        }}
      />
    </Composer>
  </div>
}

/** Собственный compiled child хранит intrinsic controls внутри host slot boundary. */
function ChatModelControls(props: Readonly<{
  usage: Contract.Input["usage"]
  label: string
  expanded: boolean
  disabled: boolean
  onToggle(): void
}>) {
  return <div
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
          label={props.label}
          endIcon={menuIcon}
          iconSize={12}
          title="Выбрать модель и уровень мышления"
          variant="text"
          aria-expanded={String(props.expanded)}
          disabled={props.disabled}
          onClick={props.onToggle}
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
}
