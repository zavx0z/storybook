import {useEffect, useRef, useState} from "@zavx0z/immersive-component"
import Button from "@zavx0z/immersive-ui-component-button-basic"
import Panel from "@zavx0z/immersive-ui-component-surface-panel"
import SwitchField from "@zavx0z/immersive-ui-component-field-switch"
import TextField from "@zavx0z/immersive-ui-component-field-text"
import Preferences from "@zavx0z/storybook-chat-preferences"
import type {StorybookAppSettings} from "@zavx0z/storybook-app-settings"
import {createSettingsClient} from "./client"

type SettingsDocument = Awaited<ReturnType<StorybookAppSettings.Output["read"]>>
type Scope = "general" | NonNullable<Parameters<StorybookAppSettings.Output["resolve"]>[0]["subject"]["type"]>
const scopes: readonly {value: Scope, label: string}[] = [
  {value: "general", label: "Общие"}, {value: "Project", label: "Проект"},
  {value: "Repo", label: "Репозитории"}, {value: "Domain", label: "Домены"},
  {value: "Cluster", label: "Кластеры"}, {value: "Container", label: "Контейнеры"}, {value: "Component", label: "Компоненты"},
]

/** Закрытое окно не держит черновик и отменяет запросы возможностей. */
export function SettingsContent(props: Readonly<{open: boolean, fetcher: typeof fetch}>) {
  return <div style={css`
    height: 100%;
    min-height: 0;
  `}>{props.open ? <SettingsLoader fetcher={props.fetcher} /> : null}</div>
}

function SettingsLoader(props: Readonly<{fetcher: typeof fetch}>) {
  const [state] = useState(() => {
    const controller = new AbortController()
    return {controller, client: createSettingsClient(props.fetcher, controller.signal)}
  })
  const [value, setValue] = useState<SettingsDocument | null>(null)
  const [error, setError] = useState("")
  const read = () => {
    setError("")
    void state.client.read().then(document => {if (!state.controller.signal.aborted) setValue(document)}, cause => {
      if (!state.controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
  }
  useEffect(() => {read(); return () => state.controller.abort()}, [state])
  return <div style={css`
    height: 100%;
    min-height: 0;
  `}>
    {value ? <SettingsForm initial={value} client={state.client} /> : <LoadState error={error} onRetry={read} />}
  </div>
}

/** Подключения и defaults редактируются отдельно, сохраняются одним проверяемым снимком. */
function SettingsForm(props: Readonly<{initial: SettingsDocument, client: ReturnType<typeof createSettingsClient>}>) {
  const [saved, setSaved] = useState(props.initial)
  const [draft, setDraft] = useState(props.initial)
  const [tab, setTab] = useState("defaults")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const alive = useRef(true)
  useEffect(() => () => {alive.current = false}, [])
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const change = (value: SettingsDocument) => {setDraft(value); setError(""); setNotice("")}
  const save = async () => {
    if (busy || !dirty) return
    setBusy(true)
    setError("")
    try {
      const value = await props.client.save(draft)
      if (alive.current) {setSaved(value); setDraft(value); setNotice("Сохранено")}
    } catch (cause) {if (alive.current) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {if (alive.current) setBusy(false)}
  }
  return <section data-provider-settings="" style={css`
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
    width: 100%;
    max-width: 680px;
    margin-inline: auto;
    padding: 20px;
    gap: 20px;
  `}>
    <div role="tablist" aria-label="Раздел настроек" style={css`
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    `}>
      <Button label="Модели по умолчанию" role="tab" selected={tab === "defaults"} aria-selected={tab === "defaults"}
        variant="text" size="large" onClick={() => setTab("defaults")} />
      <Button label="Подключения" role="tab" selected={tab === "connections"} aria-selected={tab === "connections"}
        variant="text" size="large" onClick={() => setTab("connections")} />
    </div>
    <div style={css`
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    `}>
      <div style={css`
        display: flex;
        flex-direction: column;
        width: 100%;
        max-width: 600px;
        gap: 20px;
      `}>
        {tab === "connections" ? <Connections document={draft} busy={busy} onChange={change} />
          : <Defaults document={draft} busy={busy} client={props.client} onChange={change} />}
        {error ? <SettingsError text={error} /> : null}
      </div>
    </div>
    {dirty ? <SaveActions busy={busy} onSave={() => {void save()}} onCancel={() => {setDraft(saved); setError("")}} />
      : null}
    {!dirty && notice ? <SettingsNotice text={notice} /> : null}
  </section>
}

function Connections(props: Readonly<{document: SettingsDocument, busy: boolean, onChange(value: SettingsDocument): void}>) {
  return <section aria-label="Подключения">
    {props.document.connections.map(connection => <ConnectionCard key={connection.id}
      label={connection.label} enabled={connection.enabled} busy={props.busy}
      onLabel={label => props.onChange({...props.document, connections: props.document.connections.map(item => item.id === connection.id ? {...item, label} : item)})}
      onEnabled={enabled => props.onChange({...props.document, connections: props.document.connections.map(item => item.id === connection.id ? {...item, enabled} : item)})} />)}
  </section>
}
function ConnectionCard(props: Readonly<{label: string, enabled: boolean, busy: boolean, onLabel(value: string): void, onEnabled(value: boolean): void}>) {
  return <div style={css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
    border: 1px solid var(--widget-regular-outline);
    border-radius: 8px;
  `}>
    <h3 style={css`
      margin: 0;
      font-size: 16px;
    `}>Codex</h3>
    <SwitchField label="Использовать" checked={props.enabled} disabled={props.busy} onChange={props.onEnabled} />
    <TextField label="Название" value={props.label} disabled={props.busy} onInput={props.onLabel} />
  </div>
}

type DefaultsProps = Readonly<{document: SettingsDocument, busy: boolean, client: ReturnType<typeof createSettingsClient>, onChange(value: SettingsDocument): void}>
function Defaults(props: DefaultsProps) {
  return <section aria-label="Модели по уровням" style={css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `}>
    <SettingsNotice text="Настройки уровня применяются, если у агента или беседы нет своего выбора." />
    {scopes.map(item => <LevelPanel key={item.value} level={item.value} label={item.label}
      document={props.document} busy={props.busy} client={props.client} onChange={props.onChange} />)}
  </section>
}
function LevelPanel(props: DefaultsProps & Readonly<{level: Scope, label: string}>) {
  const [open, setOpen] = useState(props.level === "general")
  return <div data-settings-level={props.level}>
    <Panel label={props.label} expanded={open} onToggle={setOpen}>
      {open ? <LevelFields level={props.level} document={props.document} busy={props.busy} client={props.client} onChange={props.onChange} /> : null}
    </Panel>
  </div>
}
function LevelFields(props: DefaultsProps & Readonly<{level: Scope}>) {
  const scope = props.level
  const [settings, setSettings] = useState<Awaited<ReturnType<ReturnType<typeof createSettingsClient>["options"]>>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const queued = useRef(Promise.resolve())
  const epoch = useRef(0)
  const selected = scope === "general" ? props.document.general : props.document.types[scope] ?? {}
  const effective = {connectionId: "codex", ...props.document.general, ...selected}
  const enabled = props.document.connections.some(item => item.id === effective.connectionId && item.enabled)
  const sources = Object.fromEntries((["connectionId", "model", "thoughtLevel"] as const).map(key => [key,
    selected[key] !== undefined ? scope === "general" ? "general" : "type" : props.document.general[key] !== undefined ? "general" : "native",
  ])) as Awaited<ReturnType<StorybookAppSettings.Output["resolve"]>>["sources"]
  useEffect(() => {
    const current = ++epoch.current
    setError("")
    if (!enabled) {setSettings([]); setLoading(false); return () => {epoch.current++}}
    setLoading(true)
    queued.current = queued.current.catch(() => {}).then(async () => {
      if (current !== epoch.current) return
      try {
        const values = await props.client.options(effective.connectionId, effective.model)
        if (current === epoch.current) setSettings(values)
      } catch (cause) {
        if (current === epoch.current) {setSettings([]); setError(cause instanceof Error ? cause.message : String(cause))}
      } finally {if (current === epoch.current) setLoading(false)}
    })
    return () => {epoch.current++}
  }, [props.client, effective.connectionId, effective.model, enabled, attempt])
  return <section aria-label="Параметры уровня" style={css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 8px;
  `}>
    <Preferences selection={selected} effective={effective} sources={sources} connections={props.document.connections}
      inheritLabel={scope === "general" ? "По умолчанию" : "Из общих настроек"}
      settings={settings} busy={props.busy || loading || !enabled} onChange={selection => props.onChange(scope === "general"
        ? {...props.document, general: selection} : {...props.document, types: {...props.document.types, [scope]: selection}})} />
    {loading ? <SettingsNotice text="Получаем модели…" /> : null}
    {!enabled ? <SettingsNotice text="Включите подключение на вкладке «Подключения»." /> : null}
    {error ? <LoadState error={error} onRetry={() => setAttempt(value => value + 1)} /> : null}
  </section>
}

function SaveActions(props: Readonly<{busy: boolean, onSave(): void, onCancel(): void}>) {
  return <div style={css`
    display: flex;
    justify-content: flex-end;
    flex-shrink: 0;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--widget-regular-outline);
  `}>
    <Button label="Отменить" variant="text" size="large" disabled={props.busy} onClick={props.onCancel} />
    <Button label={props.busy ? "Сохраняем…" : "Сохранить"} tone="primary" size="large" disabled={props.busy} onClick={props.onSave} />
  </div>
}
function LoadState(props: Readonly<{error: string, onRetry(): void}>) {
  return <div style={css`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  `}>
    {props.error ? <SettingsError text={props.error} /> : <SettingsNotice text="Загрузка…" />}
    {props.error ? <Button label="Повторить" variant="outlined" onClick={props.onRetry} /> : null}
  </div>
}
function SettingsNotice(props: Readonly<{text: string}>) {
  return <p style={css`
    margin: 0;
    font-size: 13px;
    color: var(--widget-regular-content);
  `}>{props.text}</p>
}
function SettingsError(props: Readonly<{text: string}>) {return <p role="alert">{props.text}</p>}
