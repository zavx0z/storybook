import {useState} from "@zavx0z/immersive-component"
import type {StorybookChatView} from "../../contract"
import FixtureChatView from "./history"

type Selection = NonNullable<StorybookChatView.Input["execution"]>["selection"]

/** Настройки возвращаются представлению тем же управляемым контрактом, что после сохранения хостом. */
export default function ResponseControlsFixture(props: Readonly<{
  status: "idle" | "running"
  approvalMode: "ask" | "scoped-autonomous"
  onSave(selection: Selection): void
}>) {
  const [selection, setSelection] = useState<Selection>({model: "a", thoughtLevel: "high", approvalMode: props.approvalMode})
  return <FixtureChatView
    address="/response-controls"
    label="Параметры ответа"
    messages={[]}
    draft="Сообщение"
    status={props.status}
    usage={{used: 50254, size: 828400}}
    settings={[
      {id: "model", category: "model", name: "Model", value: selection.model ?? "a", options: [{value: "a", name: "GPT-6 Astra"}, {value: "b", name: "GPT-6.1 Sol"}]},
      {id: "effort", category: "thought_level", name: "Thinking", value: selection.thoughtLevel ?? "medium", options: [{value: "low", name: "Low"}, {value: "medium", name: "Medium"}, {value: "high", name: "High"}]},
    ]}
    execution={{selection, executorSelection: {}, effective: {connectionId: "codex", model: selection.model ?? "a", thoughtLevel: selection.thoughtLevel ?? "medium", approvalMode: selection.approvalMode ?? "ask"},
      sources: {connectionId: "general", model: "session", thoughtLevel: "session", approvalMode: "session"},
      connections: [{id: "codex", provider: "codex", label: "Codex", enabled: true}],
      approvalCapabilities: {modes: ["ask", "scoped-autonomous"], autoReview: false, scope: "assignment"}}}
    onExecutionChange={value => {props.onSave(value); setSelection(value)}}
    onAttach={() => {}}
    onPrepareSettings={() => {}}
    onDraftChange={() => {}}
    onSend={() => {}}
    onCancel={() => {}}
  />
}
