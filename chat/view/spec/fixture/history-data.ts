import type {StorybookChatHistory} from "@zavx0z/storybook-chat-history"
import type {StorybookChatView} from "../../index"

type Item = StorybookChatHistory.Output[number]
type Message = Readonly<{id: string, role: "user" | "assistant" | "system", text: string}>

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

