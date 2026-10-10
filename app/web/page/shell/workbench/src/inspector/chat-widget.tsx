import {useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from "@zavx0z/immersive/XReact"
import {observeElementLayout} from "@zavx0z/immersive"
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
  const host = useRef<HTMLElement | null>(null)
  const [observedVisible, setObservedVisible] = useState(false)
  current.current = client
  const selected = choice.executorId === undefined || choice.sessionId !== undefined
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    return observeElementLayout(element, rect => {
      const visible = rect !== null && rect.width > 0 && rect.height > 0
      setObservedVisible(visible)
      client.setVisible(visible)
    })
  }, [client])
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
    ref={element => {host.current = element}}
    data-chat-widget=""
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
      onHistoryEvidence={client.historyEvidence}
      onHistoryTail={client.historyTail}
      draft={view.draft}
      status={view.status}
      activity={view.activity}
      onStop={() => {void client.stop()}}
      onCopyText={client.copyText}
      onCopyMessage={client.copyMessage}
      mediaHost={client.mediaHost}
      createGroupHistory={client.createGroupHistory}
      onHistoryRetryPage={client.historyRetryPage}
      readHistoryContent={client.readHistoryContent}
      readHistoryDetail={client.readHistoryDetail}
      readHistoryTerminal={client.readHistoryTerminal}
      sending={view.sending}
      error={view.error}
      permissions={view.permissions}
      settings={view.settings}
      execution={view.execution}
      configuring={view.configuring}
      progress={view.progress}
      usage={view.usage}
      attachments={view.attachments}
      attaching={view.attaching}
      media={view.media}
      onAttach={() => {void client.attach()}}
      onFiles={files => {void client.attachFiles(files)}}
      onRemoveAttachment={client.removeAttachment}
      onMedia={client.preview}
      onPrepareSettings={observedVisible ? () => {void client.prepare()} : undefined}
      onConfigure={(id, value) => {void client.configure(id, value)}}
      onExecutionChange={selection => {void client.configureExecution(selection)}}
      onDraftChange={client.setDraft}
      onSend={() => {void client.send()}}
      onCancel={() => {void client.cancel()}}
      onPermission={client.permission}
    /> : <EmptyChatSelection />}
  </div>
}
function EmptyChatSelection() {return <p>Выберите или создайте беседу во вкладке «Агенты».</p>}
