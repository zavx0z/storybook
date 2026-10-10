import {useState} from "@zavx0z/immersive/XReact"
import type {StorybookChatHistory} from "@zavx0z/storybook-chat-history"
import View, {type StorybookChatView} from "../../index"
import {fixtureHistory} from "./history-data"
export {fixtureHistory} from "./history-data"
import {ChatTimeline} from "../../src/timeline"

type Item = StorybookChatHistory.Output[number]
type Message = Readonly<{id: string, role: "user" | "assistant" | "system", text: string}>
type LazyKeys = "history" | "onHistoryViewport" | "onHistoryVisible" | "onHistoryExpand" | "onHistoryRetry" | "onHistoryEvidence" | "onHistoryTail"
export declare namespace FixtureContract {
  type Input = Omit<StorybookChatView.Input, LazyKeys> & Readonly<{messages: readonly Message[], timeline?: readonly Item[] | undefined}>
}

/** Scenario owner хранит fixture источник; ChatView получает только ограниченную lazy проекцию. */
export default function FixtureChatView(props: FixtureContract.Input) {
  const [expanded, setExpanded] = useState<readonly string[]>([])
  const history = fixtureHistory(props.messages, props.timeline, expanded)
  return <View
    address={props.address}
    label={props.label}
    executorId={props.executorId}
    pendingTasks={props.pendingTasks}
    draft={props.draft}
    status={props.status}
    sending={props.sending}
    error={props.error}
    onDraftChange={props.onDraftChange}
    onSend={props.onSend}
    onCancel={props.onCancel}
    onAttach={props.onAttach}
    settings={props.settings}
    execution={props.execution}
    onExecutionChange={props.onExecutionChange}
    configuring={props.configuring}
    progress={props.progress}
    usage={props.usage}
    onPrepareSettings={props.onPrepareSettings}
    onConfigure={props.onConfigure}
    permissions={props.permissions}
    onPermission={props.onPermission}
    history={history}
    onHistoryExpand={(id, value) => setExpanded(previous => value ? [...previous.filter(key => key !== id), id] : previous.filter(key => key !== id))}
    onHistoryViewport={() => {}}
    onHistoryVisible={() => {}}
    onHistoryRetry={() => {}}
    onHistoryEvidence={() => {}}
    onHistoryTail={() => {}}
  />
}

export function FixtureTimeline(props: Readonly<{messages: readonly Message[], timeline?: readonly Item[] | undefined}>) {
  return <ChatTimeline
    view={{address: "/", label: "Fixture", history: fixtureHistory(props.messages, props.timeline), draft: "", status: "idle",
      onDraftChange() {}, onSend() {}, onCancel() {}, onHistoryViewport() {}, onHistoryVisible() {}, onHistoryExpand() {}, onHistoryRetry() {}, onHistoryEvidence() {}, onHistoryTail() {}}}
  />
}
