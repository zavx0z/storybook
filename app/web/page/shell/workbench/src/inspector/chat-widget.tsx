import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from "@zavx0z/immersive-component"
import StorybookChatView, {type StorybookChatView as ViewContract} from "@zavx0z/storybook-chat-view"
import type {WorkbenchInspectorCustomWidgetProps, WorkbenchChatContext} from "../../contract/workbench.ts"
import {createChatBrowserClient} from "./chat-client.ts"

type Client = ReturnType<typeof createChatBrowserClient>
type Executors = NonNullable<ViewContract.Input["executors"]>
type TeamState = Readonly<{client: Client, items: Executors, loading: boolean, error: string}>

/** Выбор исполнителя сохраняет историю и черновик каждого участника текущего предмета. */
export function ChatWidget(props: WorkbenchInspectorCustomWidgetProps) {
  const context = props.value as WorkbenchChatContext
  const [selection, setSelection] = useState<Readonly<{address: string, executorId: string}> | null>(null)
  const executorId = selection?.address === context.address ? selection.executorId : undefined
  const client = useMemo(() => createChatBrowserClient({
    ...context,
    ...(executorId === undefined ? {} : {executorId}),
  }), [context.address, context.label, context.fetcher, executorId])
  const current = useRef(client)
  current.current = client
  const epoch = useRef(0)
  const creating = useRef<Readonly<{client: Client}> | null>(null)
  const [creatingClient, setCreatingClient] = useState<Client | null>(null)
  const [team, setTeam] = useState<TeamState | null>(null)
  const view = useSyncExternalStore(client.subscribe, client.getSnapshot)
  const visibleTeam = team?.client === client ? team : null
  useEffect(() => {
    const revision = ++epoch.current
    client.start()
    setCreatingClient(null)
    creating.current = null
    setTeam({client, items: [], loading: true, error: ""})
    void client.listExecutors().then(items => {
      if (current.current === client && epoch.current === revision) {
        setTeam({client, items, loading: false, error: ""})
      }
    }, failure => {
      if (current.current === client && epoch.current === revision) {
        setTeam({client, items: [], loading: false, error: failure instanceof Error ? failure.message : String(failure)})
      }
    })
    return () => {
      epoch.current += 1
      client.dispose()
    }
  }, [client])
  const selectExecutor = (id: string): void => {
    if (current.current !== client) return
    if (!visibleTeam?.items.some(item => item.executorId === id)) {
      setTeam({client, items: visibleTeam?.items ?? [], loading: false, error: "Исполнитель не принадлежит текущей беседе"})
      return
    }
    setSelection({address: context.address, executorId: id})
  }
  const createExecutor = async (label: string): Promise<void> => {
    if (creating.current?.client === client || current.current !== client) return
    const request = {client}
    const revision = epoch.current
    creating.current = request
    setCreatingClient(client)
    try {
      const created = await client.createExecutor(label)
      if (current.current === client && epoch.current === revision) {
        setSelection({address: context.address, executorId: created.executorId})
      }
    } catch (failure) {
      if (current.current === client && epoch.current === revision) throw failure
    } finally {
      if (creating.current === request) {
        creating.current = null
        setCreatingClient(value => value === client ? null : value)
      }
    }
  }
  const error = [view.error, visibleTeam?.error].filter(value => typeof value === "string" && value.length > 0).join("\n")
  return <StorybookChatView
    address={view.address}
    label={view.label}
    executorId={view.executorId}
    executors={visibleTeam?.items ?? []}
    pendingTasks={view.pending}
    managingExecutors={(visibleTeam?.loading ?? true) || creatingClient === client}
    onSelectExecutor={selectExecutor}
    onCreateExecutor={createExecutor}
    messages={view.messages}
    timeline={view.timeline}
    draft={view.draft}
    status={view.status}
    sending={view.sending}
    error={error}
    permissions={view.permissions}
    settings={view.settings}
    configuring={view.configuring}
    progress={view.progress}
    usage={view.usage}
    onPrepareSettings={() => { void client.prepare() }}
    onConfigure={(id, value) => { void client.configure(id, value) }}
    onDraftChange={client.setDraft}
    onSend={() => { void client.send() }}
    onCancel={() => { void client.cancel() }}
    onPermission={(id, optionId) => { void client.permission(id, optionId) }}
  />
}
