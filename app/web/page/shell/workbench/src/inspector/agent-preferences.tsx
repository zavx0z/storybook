import {useEffect, useRef, useState} from "@zavx0z/immersive-component"
import Button from "@zavx0z/immersive-ui-component-button-basic"
import Panel from "@zavx0z/immersive-ui-component-surface-panel"
import Preferences from "@zavx0z/storybook-chat-preferences"
import type {createChatBrowserClient, ChatBrowserSnapshot} from "./chat-client"

type Selection = NonNullable<ChatBrowserSnapshot["execution"]>["selection"]

/** Настройки назначения живут у предмета и сохраняются при удалении его бесед. */
export function AgentPreferences(props: Readonly<{client: ReturnType<typeof createChatBrowserClient>, executorId: string}>) {
  const [open, setOpen] = useState(false)
  return <Panel label="Модель агента" expanded={open} onToggle={setOpen}>
    {open ? <AgentPreferencesContent client={props.client} executorId={props.executorId} /> : null}
  </Panel>
}

function AgentPreferencesContent(props: Readonly<{client: ReturnType<typeof createChatBrowserClient>, executorId: string}>) {
  const [snapshot, setSnapshot] = useState<ChatBrowserSnapshot | null>(null)
  const [selection, setSelection] = useState<Selection>({})
  const [settings, setSettings] = useState<NonNullable<ChatBrowserSnapshot["settings"]>>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [loadError, setLoadError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [requests] = useState(() => new AbortController())
  const epoch = useRef(0)
  const queued = useRef(Promise.resolve())
  useEffect(() => {
    void props.client.executorPreferences(props.executorId, requests.signal).then(value => {
      if (!requests.signal.aborted) {setSnapshot(value); setSelection(value.execution?.executorSelection ?? {})}
    }, cause => {if (!requests.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))})
    return () => {requests.abort(); epoch.current++}
  }, [props.client, props.executorId, requests])
  const connectionId = selection.connectionId ?? snapshot?.execution?.effective.connectionId
  const model = selection.model ?? snapshot?.execution?.effective.model
  useEffect(() => {
    const current = ++epoch.current
    if (!connectionId) return
    setLoading(true)
    setLoadError("")
    queued.current = queued.current.catch(() => {}).then(async () => {
      if (requests.signal.aborted || current !== epoch.current) return
      try {
        const values = await props.client.executionOptions(connectionId, model, requests.signal)
        if (current === epoch.current && !requests.signal.aborted) setSettings(values)
      } catch (cause) {
        if (current === epoch.current && !requests.signal.aborted) setLoadError(cause instanceof Error ? cause.message : String(cause))
      } finally {if (current === epoch.current && !requests.signal.aborted) setLoading(false)}
    })
    return () => {epoch.current++}
  }, [props.client, connectionId, model, attempt])
  const dirty = JSON.stringify(selection) !== JSON.stringify(snapshot?.execution?.executorSelection ?? {})
  const save = async () => {
    if (saving || loading || !snapshot) return
    setSaving(true)
    setError("")
    try {
      await props.client.configureExecutor(props.executorId, selection)
      const value = await props.client.executorPreferences(props.executorId)
      if (!requests.signal.aborted) {setSnapshot(value); setSelection(value.execution?.executorSelection ?? {})}
    } catch (cause) {if (!requests.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {if (!requests.signal.aborted) setSaving(false)}
  }
  return <section data-agent-preferences="" style={css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-block: 8px;
  `}>
    {snapshot?.execution ? <Preferences
      selection={selection} effective={snapshot.execution.effective} sources={snapshot.execution.sources}
      connections={snapshot.execution.connections} settings={settings} busy={saving || loading}
      onChange={value => {setSelection(value); setError("")}}
    /> : null}
    {loading ? <AgentNotice text="Получаем модели…" /> : null}
    {error ? <AgentPreferenceError text={error} /> : null}
    {loadError ? <AgentRetry error={loadError} onRetry={() => setAttempt(value => value + 1)} /> : null}
    {dirty ? <AgentActions busy={saving || loading} onSave={() => {void save()}}
      onCancel={() => {setSelection(snapshot?.execution?.executorSelection ?? {}); setError("")}} /> : null}
  </section>
}
function AgentActions(props: Readonly<{busy: boolean, onSave(): void, onCancel(): void}>) {
  return <div style={css`
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  `}>
    <Button label="Отменить" variant="text" disabled={props.busy} onClick={props.onCancel} />
    <Button label="Сохранить" tone="primary" disabled={props.busy} onClick={props.onSave} />
  </div>
}
function AgentRetry(props: Readonly<{error: string, onRetry(): void}>) {
  return <div style={css`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  `}>
    <AgentPreferenceError text={props.error} />
    <Button label="Повторить" variant="outlined" onClick={props.onRetry} />
  </div>
}
function AgentNotice(props: Readonly<{text: string}>) {return <p>{props.text}</p>}
function AgentPreferenceError(props: Readonly<{text: string}>) {return <p role="alert">{props.text}</p>}
