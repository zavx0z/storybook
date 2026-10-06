import {useSyncExternalStore} from "@zavx0z/immersive-component"
import type {StorybookChatView} from "../../contract"
import ChatView from "../../index"

export type GroupIntegrationProps = Readonly<{
  store: {
    getSnapshot(): StorybookChatView.Input
    subscribe(listener: () => void): () => void
    rendered(): void
  }
}>

/** Тот же внешний store/подписка, что у живого ChatWidget; changed реально перерисовывает дерево. */
export default function GroupIntegration(props: GroupIntegrationProps) {
  const view = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  props.store.rendered()
  return <div
    style={css`
    display: flex;
    flex-direction: column;
    width: 480px;
    height: 700px;
    min-width: 0;
    min-height: 0;
    `}
  >
    <ChatView
      address={view.address}
      label={view.label}
      status={view.status}
      draft={view.draft}
      history={view.history}
      createGroupHistory={view.createGroupHistory}
      onDraftChange={view.onDraftChange}
      onSend={view.onSend}
      onCancel={view.onCancel}
      onHistoryViewport={view.onHistoryViewport}
      onHistoryVisible={view.onHistoryVisible}
      onHistoryExpand={view.onHistoryExpand}
      onHistoryRetry={view.onHistoryRetry}
      onHistoryEvidence={view.onHistoryEvidence}
      onHistoryTail={view.onHistoryTail}
    />
  </div>
}
