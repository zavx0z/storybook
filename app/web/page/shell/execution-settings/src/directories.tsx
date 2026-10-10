import {useEffect, useRef, useState} from "@zavx0z/immersive/XReact"
import {Button} from "@zavx0z/immersive/ui"
import {TextField} from "@zavx0z/immersive/ui"
import {Panel} from "@zavx0z/immersive/ui"
import {Typography} from "@zavx0z/immersive/ui"
import type {StorybookAppWebPageShellExecutionSettings as Contract} from "../contract"

type Client = NonNullable<Contract.Input["directories"]>
type DirectorySettings = Awaited<ReturnType<Client["read"]>>
type DirectorySettingsDraft = Parameters<Client["save"]>[0]

/** Черновик каталогов сохраняется при выборе другого раздела окна. */
export function Directories(props: Readonly<{
  client: Client
  onSetup(): void
  onError(message: string): void
  onClose(): void
}>) {
  const [saved, setSaved] = useState<DirectorySettings | null>(null)
  const [draft, setDraft] = useState<DirectorySettingsDraft>({projectsDirectory: "", repositoriesDirectory: ""})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const setError = props.onError
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
      if (value.projectsDirectory === null || value.repositoriesDirectory === null) props.onSetup()
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(errorText(cause))
        props.onSetup()
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

  return <DirectorySettingsContent
    draft={draft}
    loaded={saved !== null}
    loading={loading}
    busy={busy}
    canSave={valid && dirty}
    notice={notice}
    onChange={change}
    onRetry={() => {if (lifetime.current !== null) void read(lifetime.current)}}
    onClose={props.onClose}
    onSave={() => {void save()}}
  />
}

/** Панели и поля используют оформление библиотеки UI. */
function DirectorySettingsContent(props: Readonly<{
  draft: DirectorySettingsDraft
  loaded: boolean
  loading: boolean
  busy: boolean
  canSave: boolean
  notice: string
  onChange(patch: Partial<DirectorySettingsDraft>): void
  onRetry(): void
  onClose(): void
  onSave(): void
}>) {
  const [expanded, setExpanded] = useState(true)
  return <section
    aria-label="Каталоги среды"
    style={css`
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      height: 100%;
      min-height: 0;
      gap: var(--widget-content-gap);
      overflow-y: auto;
    `}
  >
    <Panel
      label="Расположение файлов"
      expanded={expanded}
      onToggle={setExpanded}
    >
      <DirectoryFields
        draft={props.draft}
        disabled={props.loading || props.busy || !props.loaded}
        onChange={props.onChange}
      />
    </Panel>
    {props.loading ? <DirectorySettingsMessage role="status" text="Загрузка настроек…" /> : null}
    {props.notice ? <DirectorySettingsMessage role="status" text={props.notice} /> : null}
    <div style={css`
      display: flex;
      justify-content: flex-end;
      flex-shrink: 0;
      gap: var(--widget-content-gap);
      margin-top: auto;
      padding-top: var(--widget-content-padding);
      border-top: var(--border-width-control) solid var(--widget-regular-outline);
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

function DirectoryFields(props: Readonly<{
  draft: DirectorySettingsDraft
  disabled: boolean
  onChange(patch: Partial<DirectorySettingsDraft>): void
}>) {
  return <div style={css`
    display: flex;
    flex-direction: column;
    gap: var(--spacing-4);
  `}>
    <TextField
      label="Каталог проектов"
      value={props.draft.projectsDirectory}
      disabled={props.disabled}
      onInput={value => props.onChange({projectsDirectory: value})}
    />
    <TextField
      label="Каталог репозиториев"
      value={props.draft.repositoriesDirectory}
      disabled={props.disabled}
      onInput={value => props.onChange({repositoriesDirectory: value})}
    />
  </div>
}

function DirectorySettingsMessage(props: Readonly<{role: "status" | "alert", text: string}>) {
  return <div role={props.role}>
    <Typography text={props.text} />
  </div>
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
