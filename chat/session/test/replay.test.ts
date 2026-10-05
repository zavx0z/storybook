import {expect, test} from "bun:test"
import readHistory, {type StorybookChatHistory} from "@zavx0z/storybook-chat-history"
import {receiveUpdate, type Cursor} from "../src/timeline"

test("replay по provider identity дополняет недописанное сообщение без повторной строки", () => {
  const timeline: StorybookChatHistory.Output[number][] = []
  const live: Cursor = {replayed: new Set()}
  receiveUpdate(timeline, {sessionUpdate: "agent_message_chunk", messageId: "stable", content: {type: "text", text: "Начало"}}, "live", live)
  const id = timeline[0]!.id
  const replay: Cursor = {replayed: new Set()}
  receiveUpdate(timeline, {sessionUpdate: "agent_message_chunk", messageId: "stable", content: {type: "text", text: "Начало и окончание"}}, "replay", replay)
  expect(timeline).toHaveLength(1)
  expect(timeline[0]).toMatchObject({id, providerMessageId: "stable", content: [{type: "text", text: "Начало и окончание"}]})
  expect(readHistory(timeline)).toEqual(timeline)
})

test("tool replay сохраняет одну invocation; replay без messageId не угадывает тождество", () => {
  const timeline: StorybookChatHistory.Output[number][] = []
  const cursor: Cursor = {replayed: new Set()}
  receiveUpdate(timeline, {sessionUpdate: "tool_call", toolCallId: "stable-tool", title: "Tool", status: "in_progress"}, "live", cursor)
  receiveUpdate(timeline, {sessionUpdate: "tool_call_update", toolCallId: "stable-tool", status: "completed"}, "live", cursor)
  receiveUpdate(timeline, {sessionUpdate: "tool_call", toolCallId: "stable-tool", title: "Tool", status: "completed"}, "replay", cursor)
  receiveUpdate(timeline, {sessionUpdate: "tool_call", toolCallId: "stable-tool", title: "Tool", status: "completed"}, "replay", {replayed: new Set()})
  receiveUpdate(timeline, {sessionUpdate: "agent_message_chunk", content: {type: "text", text: "Одинаковый текст"}}, "live", cursor)
  receiveUpdate(timeline, {sessionUpdate: "agent_message_chunk", content: {type: "text", text: "Одинаковый текст"}}, "replay", cursor)
  expect(timeline.filter(item => item.kind === "tool")).toHaveLength(1)
  expect(timeline[0]?.kind === "tool" ? timeline[0].updates.length : 0).toBe(4)
  const recovered = timeline.at(-1)
  expect(recovered?.origin).toBe("replay")
  expect(recovered?.kind === "message" ? recovered.diagnostic : null).toContain("не установлено")
  expect(readHistory(timeline)).toEqual(timeline)
})

test("replay initial и два update сохраняются полностью при одной строке инструмента", () => {
  const timeline: StorybookChatHistory.Output[number][] = []
  const cursor: Cursor = {replayed: new Set()}
  receiveUpdate(timeline, {sessionUpdate: "tool_call", toolCallId: "replayed-tool", title: "Чтение", status: "pending"}, "replay", cursor)
  receiveUpdate(timeline, {sessionUpdate: "tool_call_update", toolCallId: "replayed-tool", status: "in_progress", rawOutput: {part: 1}}, "replay", cursor)
  receiveUpdate(timeline, {sessionUpdate: "tool_call_update", toolCallId: "replayed-tool", status: "completed", rawOutput: {part: 2}}, "replay", cursor)
  expect(timeline).toHaveLength(1)
  const tool = timeline[0]
  expect(tool?.kind === "tool" ? tool.updates.map(event => event.update) : []).toEqual([
    {sessionUpdate: "tool_call", toolCallId: "replayed-tool", title: "Чтение", status: "pending"},
    {sessionUpdate: "tool_call_update", toolCallId: "replayed-tool", status: "in_progress", rawOutput: {part: 1}},
    {sessionUpdate: "tool_call_update", toolCallId: "replayed-tool", status: "completed", rawOutput: {part: 2}},
  ])
  expect(tool?.kind === "tool" ? new Set(tool.updates.map(event => event.id)).size : 0).toBe(3)
  expect(tool?.kind === "tool" ? new Set(tool.updates.map(event => event.batchId)).size : 0).toBe(1)
  expect(tool?.kind === "tool" ? tool.call : null).toMatchObject({status: "completed", rawOutput: {part: 2}})
  expect(readHistory(timeline)).toEqual(timeline)
})

test("nullable tool patch не стирает подтверждённые поля; явный rawOutput null сохраняется", () => {
  const timeline: StorybookChatHistory.Output[number][] = []
  const cursor: Cursor = {replayed: new Set()}
  receiveUpdate(timeline, {sessionUpdate: "tool_call", toolCallId: "nullable", title: "Имя", kind: "read", status: "in_progress", content: [{type: "content", content: {type: "text", text: "Данные"}}]}, "live", cursor)
  receiveUpdate(timeline, {sessionUpdate: "tool_call_update", toolCallId: "nullable", title: null, kind: null, status: "completed", content: null, rawOutput: null}, "live", cursor)
  expect(timeline[0]?.kind === "tool" ? timeline[0].call : null).toMatchObject({title: "Имя", kind: "read", status: "completed", content: [{type: "content", content: {type: "text", text: "Данные"}}], rawOutput: null})
  expect(readHistory(timeline)).toEqual(timeline)
})
