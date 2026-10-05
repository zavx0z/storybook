import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from "@zavx0z/immersive-component"
import {observeElementLayout} from "@zavx0z/immersive-dom"
import Panel from "@zavx0z/immersive-ui-component-surface-panel"
import Button from "@zavx0z/immersive-ui-component-button-basic"
import TextField from "@zavx0z/immersive-ui-component-field-text"
import Conversations from "@zavx0z/chat/conversations"
import type {WorkbenchChatContext, WorkbenchInspectorCustomWidgetProps} from "../../contract/workbench"
import {AgentPreferences} from "./agent-preferences"
import {createChatBrowserClient} from "./chat-client"
import {readChatSelection, selectChatSession, subscribeChatSelection} from "./chat-selection"

type Client = ReturnType<typeof createChatBrowserClient>
type Agent = Awaited<ReturnType<Client["listExecutors"]>>[number]
type Sessions = Awaited<ReturnType<Client["listSessions"]>>

/** Группировка по агентам принадлежит Storybook; имена бесед читает только раскрытый active agent. */
export function AgentsWidget(props: WorkbenchInspectorCustomWidgetProps) {
  const context = props.value as WorkbenchChatContext
  const choice = useSyncExternalStore(listener => subscribeChatSelection(context.address, listener), () => readChatSelection(context.address))
  const client = useMemo(() => {const client = createChatBrowserClient(context); client.historyVisible(false); return client}, [context.address, context.fetcher])
  const current = useRef(client)
  current.current = client
  const detailRequest = useRef<AbortController | null>(null)
  const root = useRef<HTMLElement | null>(null)
  const epoch = useRef(0)
  const [visible, setVisible] = useState(false)
  const [agents, setAgents] = useState<readonly Agent[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Sessions>([])
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const active = useRef(true)
  const mutation = useRef<object | null>(null)
  useEffect(() => {active.current = true; return () => {active.current = false; epoch.current++; detailRequest.current?.abort(); client.dispose()}}, [client])
  useEffect(() => root.current ? observeElementLayout(root.current, rect => setVisible(rect !== null && rect.width > 0 && rect.height > 0)) : undefined, [])
  useEffect(() => {
    const generation = ++epoch.current
    detailRequest.current?.abort()
    detailRequest.current = null
    setSessions([])
    if (!visible) {setAgents([]); setExpanded(null); return}
    setBusy(true)
    void client.listExecutors().then(items => {
      if (active.current && epoch.current === generation) {setAgents(items); setError("")}
    }, failure => {if (active.current && current.current === client && epoch.current === generation) setError(String(failure))})
      .finally(() => {if (active.current && epoch.current === generation) setBusy(false)})
  }, [client, visible])
  const load = async (id: string): Promise<void> => {
    const generation = ++epoch.current
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    setExpanded(id)
    setSessions([])
    setBusy(true)
    try {const items = await client.listSessions(id, controller.signal); if (active.current && current.current === client && epoch.current === generation && !controller.signal.aborted) setSessions(items)}
    catch (failure) {if (active.current && epoch.current === generation) setError(String(failure))}
    finally {if (active.current && epoch.current === generation) setBusy(false)}
  }
  const update = async (action: () => Promise<void>): Promise<void> => {
    if (busy || mutation.current !== null) return
    const operation = {}
    const generation = epoch.current
    mutation.current = operation
    setBusy(true)
    try {await action(); if (active.current && current.current === client && epoch.current === generation) setError("")}
    catch (failure) {if (active.current && current.current === client && epoch.current === generation) setError(String(failure)); throw failure}
    finally {
      if (mutation.current === operation) mutation.current = null
      if (active.current && current.current === client && epoch.current === generation) setBusy(false)
    }
  }
  return <section ref={element => {root.current = element}} data-chat-agents="">
    <TextField label="Имя агента" value={name} disabled={busy} onInput={value => setName(value)} />
    <Button
      label="Добавить специалиста"
      disabled={busy || name.trim().length === 0}
      onClick={() => {void update(async () => {
        const generation = epoch.current
        const created = await client.createExecutor(name.trim())
        if (!active.current || current.current !== client || epoch.current !== generation) return
        setName("")
        setAgents(await client.listExecutors())
        await load(created.executorId)
      }).catch(() => {})}}
    />
    {agents.map(agent => <AgentPanel
      key={agent.executorId}
      agent={agent}
      client={client}
      expanded={expanded === agent.executorId}
      sessions={expanded === agent.executorId ? sessions : []}
      selectedId={choice.executorId === agent.executorId ? choice.sessionId : undefined}
      busy={busy}
      onToggle={value => {
        if (value) void load(agent.executorId)
        else {epoch.current++; detailRequest.current?.abort(); detailRequest.current = null; setExpanded(null); setSessions([]); setBusy(false)}
      }}
      onSelect={id => {const item = sessions.find(item => item.id === id); if (item) selectChatSession(context.address, {executorId: agent.executorId, sessionId: id, title: item.title})}}
      onCreate={() => update(async () => {
        const generation = epoch.current
        const created = await client.createSession(agent.executorId)
        if (!active.current || current.current !== client || epoch.current !== generation) return
        selectChatSession(context.address, {executorId: created.executorId, sessionId: created.sessionId, title: created.sessionLabel})
        await load(agent.executorId)
      })}
      onRename={(id, title) => update(async () => {
        const generation = epoch.current
        const result = await client.renameSession(agent.executorId, id, title)
        if (!active.current || current.current !== client || epoch.current !== generation) return
        if (readChatSelection(context.address).sessionId === id) selectChatSession(context.address, {executorId: agent.executorId, sessionId: id, title: result.sessionLabel})
        await load(agent.executorId)
      })}
      onDelete={id => update(async () => {
        const generation = epoch.current
        await client.deleteSession(agent.executorId, id)
        if (!active.current || current.current !== client || epoch.current !== generation) return
        if (readChatSelection(context.address).sessionId === id) selectChatSession(context.address, {executorId: agent.executorId})
        await load(agent.executorId)
      })}
    />)}
    {error ? <AgentError error={error} /> : null}
  </section>
}

function AgentPanel(props: Readonly<{client: Client, agent: Agent, expanded: boolean, sessions: Sessions, selectedId: string | undefined, busy: boolean, onToggle(value: boolean): void, onSelect(id: string): void, onCreate(): Promise<void>, onRename(id: string, title: string): Promise<void>, onDelete(id: string): Promise<void>}>) {
  return <Panel label={props.agent.executorLabel} expanded={props.expanded} onToggle={props.onToggle}>
    {props.expanded ? <AgentContent input={props} /> : null}
  </Panel>
}
function AgentContent(input: Readonly<{input: Parameters<typeof AgentPanel>[0]}>) {
  const props = input.input
  return <div>
    <AgentPreferences client={props.client} executorId={props.agent.executorId} />
    <Conversations
      items={props.sessions}
      selectedId={props.selectedId}
      busy={props.busy}
      onSelect={props.onSelect}
      onCreate={props.onCreate}
      onRename={props.onRename}
      onDelete={props.onDelete}
    />
  </div>
}
function AgentError(props: Readonly<{error: string}>) {return <p role="alert">{props.error}</p>}
