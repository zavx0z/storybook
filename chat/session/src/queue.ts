import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"
import type {Document} from "./document"

/** Идентификатор отправки задаёт идемпотентность внутри одного исполнителя. */
export function requestIdentity(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new TypeError("Нужен идентификатор отправки")
  return value
}

/** Входящее содержимое берётся только из canonical message, на которое ссылается очередь. */
export function queuedContent(document: Document, messageId: string): Parameters<StorybookTechAcp.Output["prompt"]>[0] {
  const message = document.timeline.find(item => item.id === messageId && item.kind === "message" && item.role === "user")
  if (message?.kind !== "message") throw new Error("Входящая задача не имеет canonical user message")
  const only = message.content.length === 1 ? message.content[0] : undefined
  if (only?.type === "text" && Object.keys(only).every(key => key === "type" || key === "text")) return only.text
  return structuredClone(message.content)
}

/** Ожидающие задачи ещё не имеют durable start; незавершённая начатая задача никогда не возвращается в pending. */
export function interruptedRequest(document: Document): string | undefined {
  const started = document.timeline.findLast(item => item.kind === "turn" && item.state === "started")
  if (started?.kind !== "turn" || document.timeline.some(item => item.kind === "turn" && item.requestId === started.requestId && item.state !== "started")) return undefined
  return started.requestId
}
