import {randomUUID} from "node:crypto"
import type {StorybookTechAcp} from "@zavx0z/storybook-tech-acp"
import type {Message} from "../contract/state"
import readHistory, {type StorybookChatHistory} from "@zavx0z/storybook-chat-history"

type TimelineItem = StorybookChatHistory.Output[number]
type Content = Extract<TimelineItem, {kind: "message"}>["content"][number]
type Origin = TimelineItem["origin"]
type ToolEvent = Extract<TimelineItem, {kind: "tool"}>["updates"][number]
type Tool = Extract<TimelineItem, {kind: "tool"}>["call"]

type Update = Parameters<StorybookTechAcp.Input["onUpdate"]>[0]

/** Частное состояние текущего потока; не является вторым сохраняемым источником. */
export type Cursor = {message?: string, batchId?: string}

/** Nullable ACP patch fields оставляют прежнее значение; rawInput/rawOutput сохраняют явный null. */
function mergeTool(previous: Tool, incoming: Tool): Tool {
  const {kind, status, title, name, content, locations, ...payload} = structuredClone(incoming)
  return {...previous, ...payload, sessionUpdate: "tool_call_update",
    ...(kind == null ? {} : {kind}),
    ...(status == null ? {} : {status}),
    ...(title == null ? {} : {title}),
    ...(name == null ? {} : {name}),
    ...(content == null ? {} : {content}),
    ...(locations == null ? {} : {locations}),
  }
}

/** Порядок охватывает и изменения инструментов, вложенные в их предметные записи. */
export function nextSequence(timeline: readonly TimelineItem[]): number {
  return timeline.reduce((last, item) => Math.max(last, item.sequence,
    ...(item.kind === "tool" || item.kind === "message" ? item.updates?.map(update => update.sequence) ?? [] : [])), 0) + 1
}

/** Прежнее представление выводится только из текста канонической timeline. */
export function textMessages(timeline: readonly TimelineItem[]): Message[] {
  return timeline.flatMap(item => {
    if (item.kind !== "message" || item.role === "thought") return []
    const texts = item.content.flatMap(block => block.type === "text" ? [block.text] : [])
    return texts.length ? [{id: item.id, role: item.role, text: texts.join("")}] : []
  })
}

/** Сохраняет supplied ContentBlock без выдуманного provider context. */
export function inputContent(input: string | readonly Content[]): Content[] {
  const content = typeof input === "string" ? [{type: "text" as const, text: input}] : structuredClone([...input])
  if (!content.length || !content.every(block => block && typeof block === "object" &&
    ["text", "image", "audio", "resource", "resource_link"].includes(block.type))) {
    throw new TypeError("Сообщение должно содержать ACP ContentBlock")
  }
  const texts = content.flatMap(block => block.type === "text" ? [block.text] : [])
  if (texts.some(text => typeof text !== "string") || texts.join("").length > 64_000 ||
    !content.some(block => block.type !== "text" || block.text.trim().length > 0)) {
    throw new TypeError("Сообщение должно содержать от 1 до 64000 символов или содержимое ACP")
  }
  readHistory([{id: "input", sequence: 1, origin: "local", kind: "message", role: "user", content}])
  return content
}

/**
Объединяет только реально заданные identity. Повторный replay message заменяет
содержимое той же providerMessageId; toolCallId сохраняет один вызов. Все tool
updates остаются отдельными свидетельствами; повторная загрузка отличается batchId.
При отсутствии messageId replay сохраняется отдельно с диагностикой: похожий
текст и локальный requestId не устанавливают тождество provider message.
*/
export function receiveUpdate(timeline: TimelineItem[], update: Update, origin: "live" | "replay" | "local", cursor: Cursor): void {
  const sequence = nextSequence(timeline)
  const batch = origin === "replay" ? {batchId: cursor.batchId ??= randomUUID()} : {}
  if (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "user_message_chunk" || update.sessionUpdate === "agent_thought_chunk") {
    const role = update.sessionUpdate === "user_message_chunk" ? "user" : update.sessionUpdate === "agent_thought_chunk" ? "thought" : "assistant"
    const providerMessageId = update.messageId ?? undefined
    const identified = providerMessageId === undefined ? undefined : timeline.find(item => item.kind === "message" && item.role === role && item.providerMessageId === providerMessageId)
    const continued = providerMessageId === undefined && origin === "live" ? timeline.find(item => item.id === cursor.message && item.kind === "message" && item.role === role && item.origin === "live") : undefined
    const existing = identified ?? continued
    if (existing?.kind === "message") {
      const reset = origin === "replay" && existing.updates?.at(-1)?.batchId !== cursor.batchId
      const content = [...(reset ? [] : existing.content), structuredClone(update.content)]
      const event = {id: randomUUID(), sequence, origin, ...batch, update: structuredClone(update)}
      timeline[timeline.indexOf(existing)] = {...existing, content, updates: [...(existing.updates ?? []), event]}
      cursor.message = existing.id
    } else {
      const id = randomUUID()
      timeline.push({id, sequence, origin, ...batch, kind: "message", role, content: [structuredClone(update.content)],
        updates: [{id: randomUUID(), sequence, origin, ...batch, update: structuredClone(update)}],
        ...(providerMessageId === undefined ? {} : {providerMessageId}),
        ...(origin === "replay" && providerMessageId === undefined ? {diagnostic: "ACP replay не предоставил messageId: тождество с локальной историей не установлено."} : {}),
      })
      cursor.message = id
    }
    return
  }
  delete cursor.message
  if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
    const existing = timeline.find(item => item.kind === "tool" && item.toolCallId === update.toolCallId)
    const event: ToolEvent = {id: randomUUID(), sequence, origin, ...batch, update: structuredClone(update)}
    if (existing?.kind === "tool") {
      const updates = [...existing.updates, event]
      timeline[timeline.indexOf(existing)] = {...existing, call: mergeTool(existing.call, update), updates}
    } else timeline.push({id: randomUUID(), sequence, origin, kind: "tool", toolCallId: update.toolCallId, call: structuredClone(update), updates: [event]})
    return
  }
  timeline.push({id: randomUUID(), sequence, origin, ...batch, kind: "event", update: structuredClone(update)})
}

/** Создаёт запись с последовательностью от текущего единственного источника. */
export function recordMessage(timeline: TimelineItem[], id: string, role: "user" | "system", content: readonly Content[], origin: Origin = "local"): void {
  timeline.push({id, sequence: nextSequence(timeline), origin, kind: "message", role, content: structuredClone(content)})
}
