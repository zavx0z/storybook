import {validateContent, validateUpdate} from "./acp-validators.js"
import {z} from "zod"
import type {Content, TimelineItem} from "../contract/timeline"

const contentSchema = z.custom<Content>(value => validateContent(value), "Повреждён ACP ContentBlock")
const updateSchema = z.custom<Extract<TimelineItem, {kind: "event"}>["update"]>(value => validateUpdate(value), "Повреждён ACP SessionUpdate")
const base = {
  id: z.string().min(1),
  sequence: z.number().int().positive(),
  origin: z.enum(["local", "live", "replay", "legacy"]),
  batchId: z.string().min(1).optional(),
}
const toolEvent = z.looseObject({...base, update: updateSchema}).refine(value =>
  value.update.sessionUpdate === "tool_call" || value.update.sessionUpdate === "tool_call_update", "Ожидалось событие инструмента")
const item = z.discriminatedUnion("kind", [
  z.looseObject({...base, kind: z.literal("message"), role: z.enum(["user", "assistant", "system", "thought"]),
    content: z.array(contentSchema), providerMessageId: z.string().min(1).optional(), diagnostic: z.string().optional(),
    purpose: z.literal("command").optional(),
    updates: z.array(z.looseObject({...base, update: updateSchema})).optional()}),
  z.looseObject({...base, kind: z.literal("context"), content: z.array(contentSchema), requestId: z.string().optional()}),
  z.looseObject({...base, kind: z.literal("tool"), toolCallId: z.string().min(1), call: updateSchema, updates: z.array(toolEvent)}),
  z.looseObject({...base, kind: z.literal("turn"), requestId: z.string().min(1),
    state: z.enum(["started", "completed", "cancelled", "failed"]), stopReason: z.string().optional(), error: z.string().optional()}),
  z.looseObject({...base, kind: z.literal("event"), update: updateSchema}),
])

/** Не переписывает ContentBlock/SessionUpdate: native schema применяется как validator. */
export const timelineSchema = z.array(item).superRefine((timeline, context) => {
  const ids = new Set<string>()
  const sequences = new Set<number>()
  let last = 0
  for (const [index, entry] of timeline.entries()) {
    if (ids.has(entry.id) || entry.sequence <= last || sequences.has(entry.sequence)) {
      context.addIssue({code: "custom", path: [index], message: "Нарушены identity или порядок timeline"})
    }
    ids.add(entry.id)
    sequences.add(entry.sequence)
    last = entry.sequence
    if (entry.kind === "message" && entry.origin === "replay" && !entry.providerMessageId && !entry.diagnostic?.trim()) {
      context.addIssue({code: "custom", path: [index], message: "Replay без identity требует явной диагностики"})
    }
    const events = entry.kind === "tool" ? entry.updates : entry.kind === "message" ? entry.updates ?? [] : []
    let previousEvent = 0
    for (const event of events) {
      if (ids.has(event.id) || event.sequence < entry.sequence || event.sequence <= previousEvent ||
        event.sequence !== entry.sequence && sequences.has(event.sequence)) {
        context.addIssue({code: "custom", path: [index], message: "Нарушены identity или порядок событий записи"})
      }
      if (entry.kind === "message" && !["agent_message_chunk", "user_message_chunk", "agent_thought_chunk"].includes(event.update.sessionUpdate)) {
        context.addIssue({code: "custom", path: [index], message: "Свидетельство сообщения не является ACP chunk"})
      }
      ids.add(event.id)
      sequences.add(event.sequence)
      previousEvent = event.sequence
    }
    if (entry.kind === "tool") {
      if (!(["tool_call", "tool_call_update"].includes(entry.call.sessionUpdate)) ||
        !("toolCallId" in entry.call) || entry.call.toolCallId !== entry.toolCallId ||
        entry.updates.some(event => !("toolCallId" in event.update) || event.update.toolCallId !== entry.toolCallId)) {
        context.addIssue({code: "custom", path: [index], message: "Tool identity не совпадает с ACP payload"})
      }
    }
  }
})
