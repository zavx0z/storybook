import readHistory from "@zavx0z/storybook-chat-history"
import {defaultExecutorId} from "./identity"
import type {Message} from "../contract/state"
import type {Document} from "./document"

/** Читает версии storage; v1 text messages становятся timeline с прежними id. */
export function decodeDocument(value: unknown, address: string): Document | null {
  if (value === null || typeof value !== "object") return null
  const document = value as Record<string, unknown>
  const {id, status, error, executorId, executorLabel, sessionId, cwd, environmentContext} = document
  if (typeof id !== "string" || document.address !== address ||
    status !== "idle" && status !== "connecting" && status !== "running" && status !== "failed" ||
    !(error === null || typeof error === "string") ||
    !(sessionId === undefined || typeof sessionId === "string") ||
    !(cwd === undefined || typeof cwd === "string") ||
    !(environmentContext === undefined || typeof environmentContext === "string") ||
    !(executorLabel === undefined || typeof executorLabel === "string" && executorLabel.trim().length > 0) ||
    !(executorId === undefined || typeof executorId === "string" && executorId.length > 0)) return null
  let usage: Document["usage"]
  if (document.usage !== undefined) {
    if (document.usage === null || typeof document.usage !== "object") return null
    const supplied = document.usage as Record<string, unknown>
    const {used, size} = supplied
    if (typeof used !== "number" || !Number.isFinite(used) || used < 0 || typeof size !== "number" || !Number.isFinite(size) || size <= 0) return null
    usage = {...supplied, used, size}
  }
  const {messages, ...rest} = document
  const base: Omit<Document, "schemaVersion" | "timeline" | "pending" | "historyComplete"> = {
    ...rest, id, address, status, error,
    executorId: executorId ?? defaultExecutorId(id), executorLabel: executorLabel ?? "Основной",
    ...(sessionId === undefined ? {} : {sessionId}),
    ...(cwd === undefined ? {} : {cwd}),
    ...(environmentContext === undefined ? {} : {environmentContext}),
    ...(usage === undefined ? {} : {usage}),
  }
  if (document.schemaVersion === 1) {
    if (!Array.isArray(messages) || !messages.every(message => message &&
      typeof message.id === "string" && ["user", "assistant", "system"].includes(message.role) && typeof message.text === "string")) return null
    const timeline = (messages as Message[]).map((message, index) => ({
      id: message.id, sequence: index + 1, origin: "legacy" as const, kind: "message" as const,
      role: message.role, content: [{type: "text" as const, text: message.text}],
    }))
    return {...base, schemaVersion: 2, timeline: [...readHistory(timeline)], pending: [], historyComplete: false}
  }
  if (document.schemaVersion !== 2 || messages !== undefined || typeof document.historyComplete !== "boolean") return null
  try {
    const timeline = [...readHistory(document.timeline)]
    const pending = document.pending ?? []
    if (!Array.isArray(pending) || new Set(pending).size !== pending.length || !pending.every(id =>
      typeof id === "string" && id.startsWith("user:") &&
      timeline.some(item => item.kind === "message" && item.role === "user" && item.id === id) &&
      !timeline.some(item => item.kind === "turn" && item.requestId === id.slice(5) && item.state === "started"))) return null
    return {...base, schemaVersion: 2, timeline, pending, historyComplete: document.historyComplete}
  } catch { return null }
}
