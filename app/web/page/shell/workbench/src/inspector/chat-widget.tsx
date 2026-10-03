import {useEffect, useMemo, useSyncExternalStore} from "@zavx0z/component"
import ChatView from "@chat/view"
import type {WorkbenchInspectorCustomWidgetProps} from "../../contract/workbench.ts"
import {createChatBrowserClient} from "./chat-client.ts"

import type {WorkbenchChatContext} from "../../contract/workbench.ts"

/** Подключает историю текущего адреса к production ChatView того же Inspector. */
export function ChatWidget(props: WorkbenchInspectorCustomWidgetProps) {
  const context = props.value as WorkbenchChatContext
  const client = useMemo(() => createChatBrowserClient(context), [context.address, context.label, context.fetcher])
  const view = useSyncExternalStore(client.subscribe, client.getSnapshot)
  useEffect(() => {
    client.start()
    return () => client.dispose()
  }, [client])
  return <ChatView
    address={view.address}
    label={view.label}
    messages={view.messages}
    draft={view.draft}
    status={view.status}
    sending={view.sending}
    error={view.error ?? ""}
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
