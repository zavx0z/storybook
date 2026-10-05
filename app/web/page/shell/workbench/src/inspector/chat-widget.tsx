import {useEffect, useMemo, useRef, useSyncExternalStore} from "@zavx0z/immersive-component"
import StorybookChatView from "@zavx0z/storybook-chat-view"
import type {WorkbenchInspectorCustomWidgetProps, WorkbenchChatContext} from "../../contract/workbench"
import {createChatBrowserClient} from "./chat-client"
import {readChatSelection, selectChatSession, subscribeChatSelection} from "./chat-selection"

/** Identity выбранной беседы общая с Agents/header; скрытие освобождает только frontend данные. */
export function ChatWidget(props: WorkbenchInspectorCustomWidgetProps) {
  const context = props.value as WorkbenchChatContext
  const choice = useSyncExternalStore(listener => subscribeChatSelection(context.address, listener), () => readChatSelection(context.address))
  const ownedClient = useRef<Readonly<{client: ReturnType<typeof createChatBrowserClient>, context: WorkbenchChatContext}> | null>(null)
  const client = useMemo(() => {
    const previous = ownedClient.current
    const snapshot = previous?.client.getSnapshot()
    if (previous && previous.context.address === context.address && previous.context.label === context.label && previous.context.fetcher === context.fetcher &&
      snapshot?.address === context.address && snapshot.executorId === choice.executorId && snapshot.sessionId === choice.sessionId) return previous.client
    const next = createChatBrowserClient({...context,
    ...(choice.executorId === undefined ? {} : {executorId: choice.executorId}),
    ...(choice.sessionId === undefined ? {} : {sessionId: choice.sessionId}),
    })
    ownedClient.current = {client: next, context}
    return next
  }, [context.address, context.label, context.fetcher, choice.executorId, choice.sessionId])
  const view = useSyncExternalStore(client.subscribe, client.getSnapshot)
  const current = useRef(client)
  current.current = client
  const selected = choice.executorId === undefined || choice.sessionId !== undefined
  useEffect(() => {
    if (selected) client.start()
    return () => client.dispose()
  }, [client, selected])
  useEffect(() => {
    if (view.sessionId && view.executorId && current.current === client) selectChatSession(context.address, {
      executorId: view.executorId, sessionId: view.sessionId, ...(view.sessionLabel === undefined ? {} : {title: view.sessionLabel}),
    })
  }, [client, view.executorId, view.sessionId, view.sessionLabel])
  return <div
    style={css`
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
    `}
  >
    {selected ? <StorybookChatView
      address={view.address}
      label={view.label}
      executorId={view.executorId}
      pendingTasks={view.pending}
      history={view.history}
      onHistoryViewport={client.historyViewport}
      onHistoryVisible={client.historyVisible}
      onHistoryExpand={client.historyExpand}
      onHistoryRetry={client.historyRetry}
      onHistoryEvidence={(id, after) => {void client.historyEvidence(id, after)}}
      onHistoryTail={client.historyTail}
      draft={view.draft}
      status={view.status}
      sending={view.sending}
      error={view.error}
      permissions={view.permissions}
      settings={view.settings}
      configuring={view.configuring}
      progress={view.progress}
      usage={view.usage}
      attachments={view.attachments}
      attaching={view.attaching}
      media={view.media}
      onAttach={() => {void client.attach()}}
      onRemoveAttachment={client.removeAttachment}
      onMedia={client.preview}
      onPrepareSettings={() => {void client.prepare()}}
      onConfigure={(id, value) => {void client.configure(id, value)}}
      onDraftChange={client.setDraft}
      onSend={() => {void client.send()}}
      onCancel={() => {void client.cancel()}}
      onPermission={(id, optionId) => {void client.permission(id, optionId)}}
    /> : <EmptyChatSelection />}
  </div>
}
function EmptyChatSelection() {return <p>Выберите или создайте беседу во вкладке «Агенты».</p>}
