import {useEffect, useRef, useState} from "@zavx0z/immersive-component"
import Button from "@zavx0z/immersive-ui-component-button-basic"
import Composer from "@zavx0z/chat/composer"
import svgIcon from "@zavx0z/immersive-tech-svg-encode"
import {ChatSettings, ChatModelSettings} from "./settings"
import type {StorybookChatView as Contract} from "../contract"

const menuIcon = svgIcon('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="#aaa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>')
export function ChatComposer(input: Readonly<{view: Contract.Input}>) {
  const props = input.view
  const [settingsOpen, setSettingsOpen] = useState(false)
  const preparation = useRef<{identity: string, requested: boolean}>({identity: "", requested: false})
  const pending = props.status === "connecting" || props.status === "running" || props.configuring === true && (props.settings?.length ?? 0) === 0
  const busy = props.status === "connecting" || props.sending === true || props.attaching === true
  const settings = props.settings ?? []
  const loaded = settings.some(option => option.category === "model")
  const identity = `${props.address}:${props.executorId ?? ""}:${props.history.chatId ?? ""}:${props.execution?.effective.connectionId ?? ""}:${props.execution?.effective.model ?? ""}`
  useEffect(() => {
    if (preparation.current.identity !== identity) preparation.current = {identity, requested: false}
    if (preparation.current.requested || loaded || props.history.chatId == null || props.status !== "idle" ||
      (props.pendingTasks ?? 0) > 0 || props.configuring || props.sending || props.onPrepareSettings === undefined) return
    let active = true
    queueMicrotask(() => {
      if (!active || preparation.current.identity !== identity || preparation.current.requested) return
      preparation.current.requested = true
      props.onPrepareSettings?.()
    })
    return () => {active = false}
  }, [identity, loaded, props.status, props.pendingTasks, props.configuring, props.sending, props.onPrepareSettings])
  return <div
    data-chat-compose-region=""
    style={css`
      position: relative;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      min-width: 0;
      gap: 8px;
    `}
  >
    <ChatModelSettings
      settings={settings}
      usage={props.usage}
      busy={busy || pending || props.configuring === true}
      configuring={props.configuring === true}
      progress={props.progress}
      execution={props.execution}
      onConfigure={props.onConfigure}
      onExecutionChange={props.onExecutionChange}
    />
    {settingsOpen ? <ChatSettings
      onClose={() => setSettingsOpen(false)}
      settings={settings}
      busy={busy || pending || props.configuring === true}
      configuring={props.configuring === true}
      progress={props.progress}
      onConfigure={props.onConfigure}
      execution={props.execution}
      onExecutionChange={props.onExecutionChange}
    /> : null}
    <Composer
      sendLabel={props.status === "running" ? "Добавить в очередь" : "Отправить"}
      draft={props.draft}
      busy={busy}
      sendDisabled={props.configuring === true}
      canCancel={props.status === "connecting" || props.status === "running"}
      onDraftChange={props.onDraftChange}
      onSend={props.onSend}
      onCancel={props.onCancel}
      onFocus={() => setSettingsOpen(false)}
      attachments={props.attachments}
      onAttach={props.onAttach}
      onFiles={props.onFiles}
      onRemove={props.onRemoveAttachment}
      onPreview={attachment => props.onMedia?.({source: attachment.attachment, mimeType: attachment.attachment.mimeType, label: attachment.attachment.name})}
    >
      <ChatApprovalControl
        approval={props.execution?.effective.approvalMode === "scoped-autonomous" ? "В пределах назначения" : "С подтверждениями"}
        expanded={settingsOpen}
        disabled={props.sending === true}
        onToggle={() => setSettingsOpen(!settingsOpen)}
      />
    </Composer>
  </div>
}

/** Режим подтверждений остаётся отдельной текстовой кнопкой нижней строки. */
function ChatApprovalControl(props: Readonly<{
  approval: string
  expanded: boolean
  disabled: boolean
  onToggle(): void
}>) {
  return <div
    data-chat-approval-control=""
    style={css`
      display: flex;
      flex-direction: row;
      align-items: center;
      flex: 1 1 0;
      min-width: 0;
    `}
  >
    <Button
      label={props.approval}
      title="Режим подтверждения действий"
      variant="text"
      endIcon={menuIcon}
      iconSize={12}
      aria-expanded={String(props.expanded)}
      disabled={props.disabled}
      onClick={props.onToggle}
      style={css`
        min-width: 0;
        max-width: 100%;
        padding: 2px 4px;
        border: 0;
        color: var(--widget-regular-content);
        font-size: 12px;
      `}
    />
  </div>
}
