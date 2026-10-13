import {useEffect, useMemo, useRef, useState} from "@zavx0z/immersive/XReact"
import {Button, SelectField, Typography, Notification} from "@zavx0z/immersive/ui"
import type {BrowserProfileCatalog, SettingsClient} from "./client"

type Selection = Readonly<{name: string, saveId: string | null}>
type Props = Readonly<{
  connectionId: string
  client: SettingsClient
  onOpened(catalog: BrowserProfileCatalog): void
  onSaved(catalog: BrowserProfileCatalog): void
}>

/** Каталог и локальный выбор сохраняют текущий viewer; только observed Open/Save меняют его lifecycle. */
export function BrowserProfiles(props: Props) {
  const lifetime = useMemo(() => new AbortController(), [props.client, props.connectionId])
  const [catalog, setCatalog] = useState<BrowserProfileCatalog | null>(null)
  const [name, setName] = useState("")
  const [saveId, setSaveId] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState<"read" | "open" | "save" | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const selection = useRef<{name: string, saveId: string | null | undefined}>({name, saveId})
  selection.current = {name, saveId}
  const profiles = catalog ? [
    ...catalog.profiles,
    ...(catalog.current && !catalog.profiles.some(profile => profile.name === catalog.current!.name)
      ? [{name: catalog.current.name, saves: [], canOpen: catalog.capabilities.open}] : []),
  ] : []
  const profile = profiles.find(profile => profile.name === name)
  const working = catalog?.current?.name === name && catalog.current.saveId === null
  const choices = [
    {key: "none", value: "", label: "Выберите сохранение", saveId: undefined as string | null | undefined},
    ...(working ? [{key: "working", value: "working", label: "Текущее рабочее состояние", saveId: null}] : []),
    ...(profile?.saves.map(save => ({key: `save:${save.id}`, value: `save:${save.id}`, label: save.title ?? save.createdAt ?? save.id, saveId: save.id})) ?? []),
  ]
  const canOpen = !!catalog?.capabilities.open && !!props.client.openBrowserProfile && !!profile?.canOpen && saveId !== undefined &&
    (saveId === null ? working : profile.saves.some(save => save.id === saveId))
  const canSave = !!catalog?.capabilities.save && !!props.client.saveBrowserProfile && catalog.current !== null
  const adopt = (value: BrowserProfileCatalog) => {
    setCatalog(value)
    const previous = selection.current
    const names = [...value.profiles.map(profile => profile.name), ...(value.current ? [value.current.name] : [])]
    if (!previous.name || !names.includes(previous.name)) {
      setName(value.current?.name ?? "")
      setSaveId(value.current?.saveId)
    }
  }
  const read = async () => {
    if (!props.client.browserProfiles || busy) return
    setBusy("read")
    setError("")
    try {
      const value = await props.client.browserProfiles(props.connectionId, lifetime.signal)
      if (!lifetime.signal.aborted) adopt(value)
    } catch (cause) {if (!lifetime.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {if (!lifetime.signal.aborted) setBusy(null)}
  }
  useEffect(() => {void read(); return () => lifetime.abort()}, [lifetime])
  const open = async () => {
    if (busy || !canOpen || saveId === undefined || !props.client.openBrowserProfile) return
    const chosen: Selection = {name, saveId}
    setBusy("open")
    setError("")
    setNotice("")
    try {
      const value = await props.client.openBrowserProfile(props.connectionId, chosen, lifetime.signal)
      if (lifetime.signal.aborted) return
      if (!value.current?.active || value.current.name !== chosen.name || value.current.saveId !== chosen.saveId) throw new Error("Владелец не подтвердил открытие выбранного сохранения")
      adopt(value)
      setNotice("Профиль открыт")
      props.onOpened(value)
    } catch (cause) {if (!lifetime.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {if (!lifetime.signal.aborted) setBusy(null)}
  }
  const save = async () => {
    if (busy || !canSave || !catalog?.current || !props.client.saveBrowserProfile) return
    const current = catalog.current
    setBusy("save")
    setError("")
    setNotice("")
    try {
      const value = await props.client.saveBrowserProfile(props.connectionId, lifetime.signal)
      if (lifetime.signal.aborted) return
      if (!value.current || value.current.name !== current.name || value.current.saveId === null || value.current.active) throw new Error("Владелец не подтвердил сохранение и закрытие профиля")
      adopt(value)
      setName(value.current.name)
      setSaveId(value.current.saveId)
      setNotice("Профиль сохранён. Просмотр закрыт")
      props.onSaved(value)
    } catch (cause) {if (!lifetime.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {if (!lifetime.signal.aborted) setBusy(null)}
  }
  return <section
    aria-label="Профили и сохранения"
    style={css`
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    `}
  >
    <SelectField
      label="Профиль"
      value={name}
      options={[
        {key: "none", value: "", label: profiles.length ? "Выберите профиль" : "Профили отсутствуют"},
        ...profiles.map(profile => ({key: profile.name, value: profile.name, label: "label" in profile ? profile.label ?? profile.name : profile.name})),
      ]}
      disabled={busy !== null || profiles.length === 0}
      onChange={value => {setName(value); setSaveId(undefined); setError(""); setNotice("")}}
    />
    <SelectField
      label="Сохранение"
      value={saveId === undefined ? "" : saveId === null ? "working" : `save:${saveId}`}
      options={choices}
      disabled={busy !== null || !profile}
      onChange={value => {setSaveId(choices.find(choice => choice.value === value)?.saveId); setError(""); setNotice("")}}
    />
    {catalog?.current ? <Typography text={`Текущий профиль: ${catalog.current.name} · ${catalog.current.active ? "открыт" : "закрыт"}`} /> : null}
    <div style={css`
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-4);
    `}>
      <Button
        label={busy === "open" ? "Открываем…" : "Открыть"}
        disabled={busy !== null || !canOpen}
        onClick={() => {void open()}}
      />
      <Button
        label={busy === "save" ? "Сохраняем…" : "Сохранить профиль"}
        disabled={busy !== null || !canSave}
        onClick={() => {void save()}}
      />
      <Button
        label={busy === "read" ? "Обновляем…" : "Обновить"}
        disabled={busy !== null}
        variant="text"
        onClick={() => {void read()}}
      />
    </div>
    {notice ? <Typography text={notice} /> : null}
    {error ? <Notification message={error} tone="error" /> : null}
  </section>
}
