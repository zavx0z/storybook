import {useState} from "@zavx0z/immersive-component"
import type {StorybookChatHistory} from "@zavx0z/storybook-chat-history"
import View, {type StorybookChatView} from "../../index"
import {ChatTimeline} from "../../src/timeline"

type Item = StorybookChatHistory.Output[number]
type Message = Readonly<{id: string, role: "user" | "assistant" | "system", text: string}>
type LazyKeys = "history" | "onHistoryViewport" | "onHistoryVisible" | "onHistoryExpand" | "onHistoryRetry" | "onHistoryEvidence" | "onHistoryTail"
export declare namespace FixtureContract {
  type Input = Omit<StorybookChatView.Input, LazyKeys> & Readonly<{messages: readonly Message[], timeline?: readonly Item[] | undefined}>
}

/** Только источник малого сценария: тела доставляются в public window явно при раскрытии. */
export function fixtureHistory(messages: readonly Message[], timeline?: readonly Item[], expanded: readonly string[] = []): StorybookChatView.Input["history"] {
  const source: readonly Item[] = timeline ?? messages.map((message, index) => ({id: message.id, sequence: index + 1, role: message.role, kind: "message", origin: "local", content: [{type: "text", text: message.text}]}))
  if (source.length > 96) throw new Error("Fixture requires explicit bounded window")
  return {chatId: "fixture", revision: 1, total: source.length, before: null, after: null, unread: 0, following: true, loading: false,
    rows: source.map((item, ordinal) => ({header: {id: item.id, ordinal, sequence: item.sequence, revision: 1, kind: item.kind, origin: item.origin,
      ...(item.kind === "message" ? {role: item.role, ...(item.purpose === undefined ? {} : {purpose: item.purpose})} : {}),
      ...(item.kind === "tool" ? {...(typeof item.call.title === "string" ? {title: item.call.title} : {}), ...(typeof item.call.status === "string" ? {status: item.call.status} : {})} : {}),
      ...(item.kind === "turn" ? {state: item.state, ...(item.stopReason === undefined ? {} : {stopReason: item.stopReason}), ...(item.error === undefined ? {} : {error: item.error})} : {}), bodyBytes: 1, evidenceCount: 0},
      body: item.kind === "message" && item.role !== "thought" && item.purpose !== "command" || expanded.includes(item.id) ? item : undefined,
      expanded: expanded.includes(item.id), loading: false}))}
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
