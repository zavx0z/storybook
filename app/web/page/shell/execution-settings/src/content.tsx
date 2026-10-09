import plusIcon from "@zavx0z/immersive-ui-theme-icon-plus"
import checkIcon from "@zavx0z/immersive-ui-theme-icon-apply"
import {useEffect, useRef, useState} from "@zavx0z/immersive-component"
import Button from "@zavx0z/immersive-ui-component-button-basic"
import Panel from "@zavx0z/immersive-ui-component-surface-panel"
import TextField from "@zavx0z/immersive-ui-component-field-text"
import SelectField from "@zavx0z/immersive-ui-component-field-select"
import Preferences from "@zavx0z/storybook-chat-preferences"
import type {StorybookAppSettings} from "@zavx0z/storybook-app-settings"
import {createSettingsClient} from "./client"
import {BrowserPreview} from "./browser-preview"

type SettingsDocument = Awaited<ReturnType<StorybookAppSettings.Output["read"]>>
type Connection = SettingsDocument["connections"][number]
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
    background: #303030;

    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
    width: 100%;
    max-width: 600px;
    margin-inline: auto;
    padding: 8px;
    gap: 8px;
  `}>
    <div role="tablist" aria-label="Раздел настроек" style={css`
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    `}>
      <Button
        label="Модели по умолчанию"
        role="tab"
        selected={tab === "defaults"}
        aria-selected={tab === "defaults"}
        variant="text"
        size="small"
        onClick={() => setTab("defaults")}
      />
      <Button
        label="Провайдеры"
        role="tab"
        selected={tab === "connections"}
        aria-selected={tab === "connections"}
        variant="text"
        size="small"
        onClick={() => setTab("connections")}
      />
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
        gap: 8px;
      `}>
        {tab === "connections" ? <Connections document={draft} saved={saved} busy={busy} client={props.client} onChange={change} />
          : <Defaults document={draft} saved={saved} busy={busy} client={props.client} onChange={change} />}
        {error ? <SettingsError text={error} /> : null}
      </div>
    </div>
    {dirty ? <SaveActions busy={busy} onSave={() => {void save()}} onCancel={() => {setDraft(saved); setError("")}} />
      : null}
    {!dirty && notice ? <SettingsNotice text={notice} /> : null}
  </section>
}

type ConnectionsProps = Readonly<{
  document: SettingsDocument
  saved: SettingsDocument
  busy: boolean
  client: ReturnType<typeof createSettingsClient>
  onChange(value: SettingsDocument): void
}>
function Connections(props: ConnectionsProps) {
  const update = (connection: Connection) => props.onChange({
    ...props.document,
    connections: props.document.connections.map(item => item.id === connection.id ? connection : item),
  })
  const add = (provider: "ollama" | "capsule" | "chrome-studio") => {
    let suffix = 1
    let id: string = provider
    while (props.document.connections.some(item => item.id === id)) id = `${provider}-${++suffix}`
    const connection: Connection = provider !== "ollama" ? {
      id, provider, label: provider === "capsule" ? "Capsule" : "Chrome Studio", enabled: true,
      endpoint: {url: provider === "capsule" ? "http://127.0.0.1:17777" : "http://127.0.0.1:17778", profile: "", service: provider === "capsule" ? "qwen" : "deepseek"},
    } : {
      id, provider, label: "Ollama", enabled: true,
      endpoint: {url: "http://localhost:11434"},
    }
    props.onChange({
      ...props.document,
      connections: [...props.document.connections, connection],
    })
  }
  return <section
    aria-label="Провайдеры"
    style={css`
      display: flex;
      flex-direction: column;
      gap: 4px;
    `}
  >
    {(["codex", "ollama", "capsule", "chrome-studio"] as const).map(provider => (
      <ProviderGroup
        key={provider}
        provider={provider}
        document={props.document}
        saved={props.saved}
        busy={props.busy}
        client={props.client}
        onChange={update}
        onAdd={add}
      />
    ))}
  </section>
}
function ProviderGroup(props: Readonly<{
  provider: Connection["provider"]
  document: SettingsDocument
  saved: SettingsDocument
  busy: boolean
  client: ReturnType<typeof createSettingsClient>
  onChange(value: Connection): void
  onAdd(provider: "ollama" | "capsule" | "chrome-studio"): void
}>) {
  const [open, setOpen] = useState(false)
  const label = {codex: "Codex", ollama: "Ollama", capsule: "Capsule", "chrome-studio": "Chrome Studio"}[props.provider]
  return <Panel
    style={css`
      --panel-content-padding: 0px;
      --panel-content-background: #333333;
      --panel-header-background: #3d3d3d;
      --panel-header-inset: 0px;
      --panel-radius: 4px;
    `}
    actions={props.provider === "codex" ? [] : [{
      id: "add", label: `Добавить ${label}`, title: `Добавить ${label}`, iconSrc: plusIcon,
      disabled: props.busy,
      action: () => {
        if (props.provider !== "codex") {setOpen(true); props.onAdd(props.provider)}
      },
    }]}
    label={label}
    expanded={open}
    onToggle={setOpen}
  >
    <ProviderConnections
      provider={props.provider}
      document={props.document}
      saved={props.saved}
      busy={props.busy}
      client={props.client}
      onChange={props.onChange}
      onAdd={props.onAdd}
    />
  </Panel>
}

function ProviderConnections(props: Parameters<typeof ProviderGroup>[0]) {
  const label = {codex: "Codex", ollama: "Ollama", capsule: "Capsule", "chrome-studio": "Chrome Studio"}[props.provider]
  return <div style={css`
      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 0;
    `}>
      {props.document.connections.filter(connection => connection.provider === props.provider).map(connection => (
        <ConnectionCard
          key={connection.id}
          connection={connection}
          saved={props.saved.connections.find(item => item.id === connection.id)}
          busy={props.busy}
          client={props.client}
          onChange={props.onChange}
        />
      ))}

    </div>
}
function ConnectionCard(props: Readonly<{
  connection: Connection
  saved: Connection | undefined
  busy: boolean
  client: ReturnType<typeof createSettingsClient>
  onChange(value: Connection): void
}>) {
  const [open, setOpen] = useState(!props.saved)
  const [probing, setProbing] = useState(false)
  const [result, setResult] = useState("")
  const [error, setError] = useState("")
  const alive = useRef(true)
  useEffect(() => () => {alive.current = false}, [])
  const connection = props.connection
  const dirty = JSON.stringify(connection) !== JSON.stringify(props.saved)
  useEffect(() => {setResult(""); setError("")}, [connection])
  const probe = async () => {
    if (dirty || probing || props.busy || !connection.enabled) return
    setProbing(true)
    setResult("")
    setError("")
    try {
      const options = await props.client.options(connection.id)
      const count = options.find(item => item.category === "model")?.options.length ?? 0
      if (alive.current) setResult(`Подключение доступно. Моделей: ${count}.`)
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {if (alive.current) setProbing(false)}
  }
  return <Panel
    style={css`
      --panel-content-padding: 0px;
      --panel-content-background: #333333;
      --panel-header-background: #3d3d3d;
      --panel-header-inset: 12px;
      --panel-radius: 0px;
    `}
    label={connection.label}
    checked={connection.enabled}
    checkDisabled={props.busy || probing}
    onCheckedChange={enabled => props.onChange({...connection, enabled})}
    actions={[{
      id: "probe", label: probing ? "Проверяем…" : "Проверить подключение",
      title: "Проверить подключение", iconSrc: checkIcon,
      disabled: props.busy || probing || dirty || !connection.enabled,
      action: () => {void probe()},
    }]}
    expanded={open}
    onToggle={setOpen}
  >
    {open ? <ConnectionFields
      client={props.client}
      connection={connection}
      busy={props.busy}
      probing={probing}
      dirty={dirty}
      result={result}
      error={error}
      onChange={props.onChange}
      onProbe={() => {void probe()}}
    /> : null}
  </Panel>
}
function ConnectionFields(props: Readonly<{
  client: ReturnType<typeof createSettingsClient>
  connection: Connection
  busy: boolean
  probing: boolean
  dirty: boolean
  result: string
  error: string
  onChange(value: Connection): void
  onProbe(): void
}>) {
  const connection = props.connection
  return <section
    data-provider-connection={connection.id}
    style={css`
      background: #333333;
      border-radius: 0;

      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 0;
    `}
  >
    {(connection.provider === "capsule" || connection.provider === "chrome-studio") ? <BrowserPreview
      provider={connection.provider}
      connectionId={connection.id}
      available={!props.dirty && connection.enabled}
      client={props.client}
    /> : null}

      <TextField
        style={css`
          --field-label-height: var(--control-height-medium);
          padding: 0 12px 0 28px;
        `}
        label="Название"
        value={connection.label}
        disabled={props.busy || props.probing}
        onInput={label => props.onChange({...connection, label})}
      />
      {connection.provider === "ollama" ? <OllamaFields
        connection={connection}
        busy={props.busy || props.probing}
        onChange={props.onChange}
      /> : null}
      {(connection.provider === "capsule" || connection.provider === "chrome-studio") ? <BrowserProfileFields
        connection={connection}
        busy={props.busy || props.probing}
        onChange={props.onChange}
      /> : null}

      {props.dirty ? <SettingsNotice text="Сохраните изменения, чтобы проверить подключение и получить модели." /> : null}
      {props.result ? <SettingsNotice text={props.result} /> : null}
      {props.error ? <SettingsError text={props.error} /> : null}
    </section>
}
function BrowserProfileFields(props: Readonly<{
  connection: Extract<Connection, {provider: "capsule" | "chrome-studio"}>
  busy: boolean
  onChange(value: Connection): void
}>) {
  const [remoteOpen, setRemoteOpen] = useState(false)
  const endpoint = props.connection.endpoint
  return <section
    aria-label={props.connection.provider === "capsule" ? "Подключение Capsule" : "Подключение Chrome Studio"}
    style={css`
      display: flex;
      flex-direction: column;
      gap: 0;
    `}
  >
    <TextField
        style={css`
          --field-label-height: var(--control-height-medium);
          padding: 0 12px 0 28px;
        `}
      label="Адрес Studio"
      type="url"
      value={endpoint.url}
      disabled={props.busy}
      onInput={url => props.onChange({...props.connection, endpoint: {...endpoint, url}})}
    />
    <TextField
        style={css`
          --field-label-height: var(--control-height-medium);
          padding: 0 12px 0 28px;
        `}
      label="Профиль"
      value={endpoint.profile}
      disabled={props.busy}
      onInput={profile => props.onChange({...props.connection, endpoint: {...endpoint, profile}})}
    />
    <SelectField
        style={css`
          padding: 0 12px 0 28px;
        `}
      label="Сервис"
      value={endpoint.service}
      options={[
        {key: "qwen", value: "qwen", label: "Qwen"},
        {key: "deepseek", value: "deepseek", label: "DeepSeek"},
        {key: "chatgpt", value: "chatgpt", label: "ChatGPT"},
      ]}
      disabled={props.busy}
      onChange={service => {
        if (service === "qwen" || service === "deepseek" || service === "chatgpt") props.onChange({...props.connection, endpoint: {...endpoint, service}})
      }}
    />
    <Panel
    style={css`
      --panel-content-padding: 0px;
      --panel-content-background: #333333;
      --panel-header-background: #3d3d3d;
      --panel-header-inset: 24px;
      --panel-radius: 0px;
    `}
      label="SSH"
      checked={!!props.connection.ssh}
      checkDisabled={props.busy}
      onCheckedChange={enabled => {
        const {ssh, ...local} = props.connection
        props.onChange(enabled ? {...local, ssh: {host: "", providerRoot: "", storageRoot: ""}} : local)
      }}
      expanded={remoteOpen}
      onToggle={setRemoteOpen}
    >
      <BrowserSshFields
      connection={props.connection}
      busy={props.busy}
      onChange={props.onChange}
    />
    </Panel>
  </section>
}
function BrowserSshFields(props: Parameters<typeof BrowserProfileFields>[0]) {
  return <div style={css`
      background: #333333;
      border-radius: 0;

        display: flex;
        flex-direction: column;
        gap: 0;
        padding: 0;
      `}>

        {props.connection.ssh ? <BrowserRemoteFields
          docker={props.connection.provider === "capsule"}
          ssh={props.connection.ssh}
          busy={props.busy}
          onChange={ssh => props.onChange({...props.connection, ssh})}
        /> : null}
      </div>
}
function BrowserRemoteFields(props: Readonly<{
  docker?: boolean
  ssh: NonNullable<Extract<Connection, {provider: "capsule"}>["ssh"]>
  busy: boolean
  onChange(value: NonNullable<Extract<Connection, {provider: "capsule"}>["ssh"]>): void
}>) {
  return <section aria-label={props.docker ? "Удалённое исполнение Capsule" : "Удалённое исполнение Chrome Studio"}>
    <SSHFields
      ssh={props.ssh}
      busy={props.busy}
      onChange={value => {
        const {host, user, port, ...paths} = props.ssh
        props.onChange({...paths, ...value})
      }}
    />
      <BrowserPaths
      docker={props.docker ?? false}
      ssh={props.ssh}
      busy={props.busy}
      onChange={props.onChange}
    />
  </section>
}
function BrowserPaths(props: Parameters<typeof BrowserRemoteFields>[0]) {
  return <section
        aria-label="Размещение Provider на удалённой машине"
        style={css`
      background: #333333;
      border-radius: 0;

          display: flex;
          flex-direction: column;
          gap: 0;
          padding: 0;
        `}
      >

        <TextField
        style={css`
          --field-label-height: var(--control-height-medium);
          padding: 0 12px 0 28px;
        `}
          label="Provider"
          value={props.ssh.providerRoot}
          disabled={props.busy}
          onInput={providerRoot => props.onChange({...props.ssh, providerRoot})}
        />
        <TextField
        style={css`
          --field-label-height: var(--control-height-medium);
          padding: 0 12px 0 28px;
        `}
          label="Данные"
          value={props.ssh.storageRoot}
          disabled={props.busy}
          onInput={storageRoot => props.onChange({...props.ssh, storageRoot})}
        />
        {props.docker ? <TextField
        style={css`
          --field-label-height: var(--control-height-medium);
          padding: 0 12px 0 28px;
        `}
          label="Docker context"
          value={props.ssh.dockerContext ?? ""}
          disabled={props.busy}
          onInput={value => {
            const {dockerContext, ...ssh} = props.ssh
            props.onChange(value ? {...ssh, dockerContext: value} : ssh)
          }}
        /> : null}
      </section>
}
function OllamaFields(props: Readonly<{
  connection: Extract<Connection, {provider: "ollama"}>
  busy: boolean
  onChange(value: Connection): void
}>) {
  const [remoteOpen, setRemoteOpen] = useState(false)
  const endpoint = props.connection.endpoint
  const updateSSH = (value: NonNullable<typeof endpoint.ssh>) => props.onChange({
    ...props.connection,
    endpoint: {...endpoint, ssh: value},
  })
  return <section
    aria-label="Подключение Ollama"
    style={css`
      display: flex;
      flex-direction: column;
      gap: 0;
    `}
  >
    <TextField
        style={css`
          --field-label-height: var(--control-height-medium);
          padding: 0 12px 0 28px;
        `}
      label="URL API Ollama"
      type="url"
      value={endpoint.url}
      disabled={props.busy}
      onInput={url => props.onChange({...props.connection, endpoint: {...endpoint, url}})}
    />
    <Panel
    style={css`
      --panel-content-padding: 0px;
      --panel-content-background: #333333;
      --panel-header-background: #3d3d3d;
      --panel-header-inset: 24px;
      --panel-radius: 0px;
    `}
      label="SSH"
      checked={!!endpoint.ssh}
      checkDisabled={props.busy}
      onCheckedChange={enabled => {
        const {ssh, ...direct} = endpoint
        props.onChange({...props.connection, endpoint: enabled ? {...direct, ssh: {host: ""}} : direct})
      }}
      expanded={remoteOpen}
      onToggle={setRemoteOpen}
    >
      <OllamaSshFields
      connection={props.connection}
      busy={props.busy}
      onChange={props.onChange}
    />
    </Panel>
  </section>
}

function OllamaSshFields(props: Parameters<typeof OllamaFields>[0]) {
  const endpoint = props.connection.endpoint
  const updateSSH = (value: NonNullable<typeof endpoint.ssh>) => props.onChange({...props.connection, endpoint: {...endpoint, ssh: value}})
  return <div style={css`
      background: #333333;
      border-radius: 0;

        display: flex;
        flex-direction: column;
        gap: 0;
        padding: 0;
      `}>

        {endpoint.ssh ? <SSHFields
          ssh={endpoint.ssh}
          busy={props.busy}
          onChange={updateSSH}
        /> : null}
      </div>
}
function SSHFields(props: Readonly<{
  ssh: NonNullable<Extract<Connection, {provider: "ollama"}>["endpoint"]["ssh"]>
  busy: boolean
  onChange(value: NonNullable<Extract<Connection, {provider: "ollama"}>["endpoint"]["ssh"]>): void
}>) {
  return <section
    aria-label="SSH"
    style={css`
      display: flex;
      flex-direction: column;
      gap: 0;
    `}
  >

      <TextField
        style={css`
          --field-label-height: var(--control-height-medium);
          padding: 0 12px 0 28px;
        `}
        label="Хост"
        value={props.ssh.host}
        disabled={props.busy}
        onInput={host => props.onChange({...props.ssh, host})}
      />
      <TextField
        style={css`
          --field-label-height: var(--control-height-medium);
          padding: 0 12px 0 28px;
        `}
        label="Пользователь"
        value={props.ssh.user ?? ""}
        disabled={props.busy}
        onInput={user => {
          const {user: previous, ...ssh} = props.ssh
          props.onChange(user ? {...ssh, user} : ssh)
        }}
      />
      <TextField
        style={css`
          --field-label-height: var(--control-height-medium);
          padding: 0 12px 0 28px;
        `}
        label="Порт"
        value={props.ssh.port?.toString() ?? ""}
        disabled={props.busy}
        onInput={value => {
          const {port: previous, ...ssh} = props.ssh
          props.onChange(value ? {...ssh, port: Number(value)} : ssh)
        }}
      />
    </section>
}

type DefaultsProps = Readonly<{document: SettingsDocument, saved: SettingsDocument, busy: boolean, client: ReturnType<typeof createSettingsClient>, onChange(value: SettingsDocument): void}>
function Defaults(props: DefaultsProps) {
  return <section aria-label="Модели по уровням" style={css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `}>
    <SettingsNotice text="Настройки уровня применяются, если у агента или беседы нет своего выбора." />
    {scopes.map(item => (
      <LevelPanel
        key={item.value}
        level={item.value}
        label={item.label}
        document={props.document}
        saved={props.saved}
        busy={props.busy}
        client={props.client}
        onChange={props.onChange}
      />
    ))}
  </section>
}
function LevelPanel(props: DefaultsProps & Readonly<{level: Scope, label: string}>) {
  const [open, setOpen] = useState(props.level === "general")
  return <div data-settings-level={props.level}>
    <Panel label={props.label} expanded={open} onToggle={setOpen}>
      {open ? <LevelFields
        level={props.level}
        document={props.document}
        saved={props.saved}
        busy={props.busy}
        client={props.client}
        onChange={props.onChange}
      /> : null}
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
  const inherited = {...props.document.general}
  if (selected.connectionId && selected.connectionId !== inherited.connectionId) {
    delete inherited.model
    delete inherited.thoughtLevel
  } else if (selected.model && selected.model !== inherited.model) delete inherited.thoughtLevel
  const effective = {connectionId: "codex", ...inherited, ...selected}
  const connection = props.document.connections.find(item => item.id === effective.connectionId)
  const savedConnection = props.saved.connections.find(item => item.id === effective.connectionId)
  const connectionDirty = JSON.stringify(connection) !== JSON.stringify(savedConnection)
  const enabled = props.document.connections.some(item => item.id === effective.connectionId && item.enabled)
  const sources = Object.fromEntries((["connectionId", "model", "thoughtLevel"] as const).map(key => [key,
    selected[key] !== undefined ? scope === "general" ? "general" : "type" : inherited[key] !== undefined ? "general" : "native",
  ])) as Awaited<ReturnType<StorybookAppSettings.Output["resolve"]>>["sources"]
  useEffect(() => {
    const current = ++epoch.current
    setError("")
    if (!enabled || connectionDirty) {setSettings([]); setLoading(false); return () => {epoch.current++}}
    setSettings([])
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
  }, [props.client, effective.connectionId, effective.model, enabled, connectionDirty, props.saved.revision, attempt])
  return <section aria-label="Параметры уровня" style={css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 8px;
  `}>
    <Preferences
      selection={selected}
      effective={effective}
      sources={sources}
      connections={props.document.connections}
      inheritLabel={scope === "general" ? "По умолчанию" : "Из общих настроек"}
      settings={settings}
      busy={props.busy}
      onChange={selection => props.onChange(scope === "general"
        ? {...props.document, general: selection}
        : {...props.document, types: {...props.document.types, [scope]: selection}})}
    />
    {connectionDirty ? <SettingsNotice text="Сохраните изменения провайдера, чтобы получить его модели." /> : null}
    {loading ? <SettingsNotice text="Получаем модели…" /> : null}
    {!enabled ? <SettingsNotice text="Включите подключение на вкладке «Провайдеры»." /> : null}
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
