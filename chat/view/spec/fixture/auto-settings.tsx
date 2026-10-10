import {useLayoutEffect, useRef, useState} from "@zavx0z/immersive/XReact"
import type {StorybookChatView} from "../../contract"
import FixtureChatView from "./history"

/** Управляемая задержка ответа хоста сохраняет настоящий cold UI и локальное состояние ввода. */
export default function AutoSettingsFixture(props: Readonly<{
  status: StorybookChatView.Input["status"]
  pendingTasks?: number
  initialError?: string
  response: Promise<void>
  onPrepare(): void
  onSend(): void
  onAttach(): void
}>) {
  const [draft, setDraft] = useState("")
  const [configuring, setConfiguring] = useState(false)
  const [settings, setSettings] = useState<NonNullable<StorybookChatView.Input["settings"]>>([])
  const [error, setError] = useState(props.initialError ?? "")
  const alive = useRef(true)
  useLayoutEffect(() => () => {alive.current = false}, [])
  return <FixtureChatView
    address="/auto-settings"
    label="Автоматическая загрузка"
    messages={[]}
    draft={draft}
    status={props.status}
    pendingTasks={props.pendingTasks}
    configuring={configuring}
    progress="Подключение к исполнителю…"
    settings={settings}
    error={error}
    onPrepareSettings={() => {
      props.onPrepare()
      setConfiguring(true)
      setError("")
      void props.response.then(() => {
        if (!alive.current) return
        setSettings([
          {id: "model", category: "model", name: "Модель", value: "a", options: [{value: "a", name: "GPT-6 Astra"}]},
          {id: "effort", category: "thought_level", name: "Усилие", value: "high", options: [{value: "high", name: "Высокое"}]},
        ])
        setConfiguring(false)
      }, failure => {
        if (!alive.current) return
        setError(failure instanceof Error ? failure.message : String(failure))
        setConfiguring(false)
      })
    }}
    onConfigure={() => {}}
    onDraftChange={setDraft}
    onSend={props.onSend}
    onAttach={props.onAttach}
    onCancel={() => {}}
  />
}
