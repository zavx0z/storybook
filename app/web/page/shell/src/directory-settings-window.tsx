import {useEffect, useRef, useState} from "@zavx0z/immersive-component"
import Button from "@zavx0z/immersive-ui-component-button-basic"
import TextField from "@zavx0z/immersive-ui-component-field-text"
import Tab from "@zavx0z/immersive-ui-component-surface-tab"
import Window from "@zavx0z/immersive-ui-component-surface-window"
import WindowControl from "@zavx0z/immersive-ui-component-surface-window-control"
import type {createDirectorySettingsClient, DirectorySettings, DirectorySettingsDraft} from "./directory-settings-client"

type Client = ReturnType<typeof createDirectorySettingsClient>
type TabPosition = NonNullable<Parameters<typeof Tab>[0]["position"]>

/** Окно каталогов и его Tab принадлежат HUD существующего Browser Root. */
export function DirectorySettingsWindow(props: Readonly<{client: Client}>) {
  const [open, setOpen] = useState(false)
  const [geometry, setGeometry] = useState({x: 80, y: 80, width: 600, height: 380})
  const [tab, setTab] = useState<TabPosition>({edge: "top", offset: .55})
  const [saved, setSaved] = useState<DirectorySettings | null>(null)
  const [draft, setDraft] = useState<DirectorySettingsDraft>({projectsDirectory: "", repositoriesDirectory: ""})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const lifetime = useRef<AbortController | null>(null)
  const reading = useRef(false)
  const saving = useRef(false)

  const read = async (controller: AbortController) => {
    if (reading.current) return
    reading.current = true
    setLoading(true)
    setError("")
    try {
      const value = await props.client.read(controller.signal)
      if (controller.signal.aborted) return
      setSaved(value)
      setDraft({projectsDirectory: value.projectsDirectory ?? "", repositoriesDirectory: value.repositoriesDirectory ?? ""})
      if (value.projectsDirectory === null || value.repositoriesDirectory === null) setOpen(true)
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(errorText(cause))
        setOpen(true)
      }
    } finally {
      reading.current = false
      if (!controller.signal.aborted) setLoading(false)
    }
  }
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void read(controller)
    return () => controller.abort()
  }, [props.client])

  const change = (patch: Partial<DirectorySettingsDraft>) => {
    setDraft(value => ({...value, ...patch}))
    setError("")
    setNotice("")
  }
  const valid = draft.projectsDirectory.trim().length > 0 && draft.repositoriesDirectory.trim().length > 0
  const dirty = saved === null || draft.projectsDirectory !== saved.projectsDirectory || draft.repositoriesDirectory !== saved.repositoriesDirectory
  const save = async () => {
    const controller = lifetime.current
    if (saving.current || !valid || !dirty || controller === null || controller.signal.aborted) return
    saving.current = true
    setBusy(true)
    setError("")
    setNotice("")
    try {
      const value = await props.client.save(draft, controller.signal)
      if (controller.signal.aborted) return
      setSaved(value)
      setDraft({projectsDirectory: value.projectsDirectory ?? "", repositoriesDirectory: value.repositoriesDirectory ?? ""})
      setNotice("Каталоги сохранены.")
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorText(cause))
    } finally {
      saving.current = false
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return <div
    data-directory-settings=""
    style={css`
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    `}
  >
    <Window
      id="storybook-directory-settings"
      title="Настройки"
      open={open}
      onOpenChange={setOpen}
      geometry={geometry}
      onGeometryChange={(next, phase) => {if (phase !== "change") setGeometry(next)}}
      movable={true}
      resizable={true}
      minWidth={340}
      minHeight={280}
    >
      <DirectorySettingsContent
        draft={draft}
        loaded={saved !== null}
        loading={loading}
        busy={busy}
        canSave={valid && dirty}
        error={error}
        notice={notice}
        onChange={change}
        onRetry={() => {if (lifetime.current !== null) void read(lifetime.current)}}
        onClose={() => setOpen(false)}
        onSave={() => {void save()}}
      />
    </Window>
    {open ? null : <Tab
      label="Настройки"
      position={tab}
      onPositionChange={(next, phase) => {if (phase === "end") setTab(next)}}
    >
      <WindowControl
        windowId="storybook-directory-settings"
        label="Настройки"
        open={open}
        onOpenChange={setOpen}
      />
    </Tab>}
  </div>
}

/** Содержимое передаётся Window как компонент через его штатный безымянный слот. */
function DirectorySettingsContent(props: Readonly<{
  draft: DirectorySettingsDraft
  loaded: boolean
  loading: boolean
  busy: boolean
  canSave: boolean
  error: string
  notice: string
  onChange(patch: Partial<DirectorySettingsDraft>): void
  onRetry(): void
  onClose(): void
  onSave(): void
}>) {
  return <section
    aria-label="Каталоги среды"
    style={css`
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      height: 100%;
      min-height: 0;
      padding: 20px;
      gap: 16px;
      overflow-y: auto;
    `}
  >
    <TextField
      label="Каталог проектов"
      value={props.draft.projectsDirectory}
      disabled={props.loading || props.busy || !props.loaded}
      onInput={value => props.onChange({projectsDirectory: value})}
    />
    <TextField
      label="Каталог репозиториев"
      value={props.draft.repositoriesDirectory}
      disabled={props.loading || props.busy || !props.loaded}
      onInput={value => props.onChange({repositoriesDirectory: value})}
    />
    <p style={css`
      margin: 0;
      font-size: 13px;
    `}>Сохранение меняет настройки среды. Существующие файлы остаются на месте.</p>
    {props.loading ? <DirectorySettingsMessage role="status" text="Загрузка настроек…" /> : null}
    {props.error ? <DirectorySettingsMessage role="alert" text={props.error} /> : null}
    {props.notice ? <DirectorySettingsMessage role="status" text={props.notice} /> : null}
    <div style={css`
      display: flex;
      justify-content: flex-end;
      flex-shrink: 0;
      gap: 8px;
    `}>
      {!props.loaded && !props.loading ? <Button
        label="Повторить загрузку"
        variant="outlined"
        onClick={props.onRetry}
      /> : null}
      <Button
        label="Закрыть"
        variant="text"
        disabled={props.busy}
        onClick={props.onClose}
      />
      <Button
        label={props.busy ? "Сохраняем…" : "Сохранить"}
        tone="primary"
        disabled={props.loading || props.busy || !props.loaded || !props.canSave}
        onClick={props.onSave}
      />
    </div>
  </section>
}

function DirectorySettingsMessage(props: Readonly<{role: "status" | "alert", text: string}>) {
  return <p role={props.role}>{props.text}</p>
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
