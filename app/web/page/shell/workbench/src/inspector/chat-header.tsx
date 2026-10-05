import {useEffect, useMemo, useRef, useSyncExternalStore} from "@zavx0z/immersive-component"
import Header from "@zavx0z/chat/header"
import type {WorkbenchChatContext} from "../../contract/workbench"
import {createChatBrowserClient} from "./chat-client"
import {readChatSelection, selectChatSession, subscribeChatSelection} from "./chat-selection"

/** Верхний header читает только scalar identity; metadata actions не загружают историю. */
export function ChatSessionHeader(props: Readonly<{context: WorkbenchChatContext}>) {
  const context = props.context
  const selection = useSyncExternalStore(listener => subscribeChatSelection(context.address, listener), () => readChatSelection(context.address))
  const client = useMemo(() => {
    const client = createChatBrowserClient({...context,
      ...(selection.executorId === undefined ? {} : {executorId: selection.executorId}),
      ...(selection.sessionId === undefined ? {} : {sessionId: selection.sessionId}),
    })
    client.historyVisible(false)
    return client
  }, [context.address, context.fetcher, selection.executorId, selection.sessionId])
  const current = useRef(client)
  current.current = client
  useEffect(() => () => client.dispose(), [client])
  return <Header
    id={selection.sessionId ?? "unselected"}
    title={selection.title ?? "Выберите беседу"}
    busy={selection.executorId === undefined || selection.sessionId === undefined}
    onRename={async title => {
      if (!selection.executorId || !selection.sessionId) return
      const snapshot = await client.renameSession(selection.executorId, selection.sessionId, title)
      if (current.current !== client || readChatSelection(context.address).sessionId !== snapshot.sessionId) return
      selectChatSession(context.address, {executorId: snapshot.executorId, sessionId: snapshot.sessionId, title: snapshot.sessionLabel})
    }}
  />
}
