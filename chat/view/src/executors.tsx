import {useEffect, useRef, useState} from "@zavx0z/immersive-component"
import {Button, SelectField, TextField} from "@zavx0z/immersive-ui-component"
import type {StorybookChatView as Contract} from "../contract"
import {ChatError, ChatNotice} from "./feedback"

/** Участники адресной беседы; создание специалиста не изменяет сообщение или модель. */
export function ChatExecutors(input: Readonly<{view: Contract.Input}>) {
  const props = input.view
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")
  const locked = useRef(false)
  const active = useRef(true)
  useEffect(() => () => { active.current = false }, [])
  const busy = creating || props.managingExecutors === true
  const options = (props.executors ?? []).map(executor => ({
    key: executor.executorId,
    value: executor.executorId,
    label: executor.executorLabel,
    description: executor.pending.length > 0 ? `В очереди: ${executor.pending.length}` : undefined,
  }))
  const canCreate = label.trim().length > 0 && !busy && props.onCreateExecutor !== undefined
  const create = async (): Promise<void> => {
    if (locked.current || !canCreate) return
    locked.current = true
    setCreating(true)
    setError("")
    try {
      await props.onCreateExecutor?.(label.trim())
      if (!active.current) return
      setLabel("")
      setAdding(false)
    } catch (failure) {
      if (active.current) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      locked.current = false
      if (active.current) setCreating(false)
    }
  }
  return <section
    aria-label="Участники беседы"
    data-chat-executors=""
    style={css`
      display: flex;
      flex-direction: column;
      min-width: 0;
      width: 100%;
      gap: 6px;
    `}
  >
    <SelectField
      label="Участник"
      title="Исполнитель беседы"
      value={props.executorId ?? ""}
      options={options}
      disabled={busy || props.onSelectExecutor === undefined || options.length === 0}
      onChange={id => props.onSelectExecutor?.(id)}
    />
    {(props.pendingTasks ?? 0) > 0 ? <ChatNotice
      text={`Задач в очереди: ${props.pendingTasks}`}
    /> : null}
    {props.managingExecutors && !creating ? <ChatNotice
      text="Обновление участников…"
    /> : null}
    <Button
      label={adding ? "Отменить добавление" : "Добавить специалиста"}
      variant="text"
      disabled={busy || props.onCreateExecutor === undefined}
      onClick={() => {
        setAdding(!adding)
        setError("")
      }}
    />
    {adding ? <CreateExecutorForm
      label={label}
      busy={busy}
      canCreate={canCreate}
      onLabel={setLabel}
      onCreate={() => { void create() }}
    /> : null}
    {error ? <ChatError
      error={error}
    /> : null}
  </section>
}

/** Имя специалиста хранится отдельно от текста задачи и очищается только после создания. */
function CreateExecutorForm(props: Readonly<{
  label: string
  busy: boolean
  canCreate: boolean
  onLabel(value: string): void
  onCreate(): void
}>) {
  return <div
    data-chat-create-executor=""
    style={css`
      display: flex;
      flex-direction: column;
      min-width: 0;
      gap: 6px;
    `}
  >
    <TextField
      label="Имя специалиста"
      title="Имя специалиста"
      value={props.label}
      placeholder="Например, исследователь"
      disabled={props.busy}
      onInput={value => props.onLabel(value)}
    />
    <Button
      label={props.busy ? "Создание…" : "Создать"}
      disabled={!props.canCreate}
      onClick={() => props.onCreate()}
    />
  </div>
}
