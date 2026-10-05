import {expect, test} from "bun:test"
import readHistory from "../index"

test("reader сохраняет ACP metadata и media без ссылки на исходный объект", () => {
  const input = [{id: "message", sequence: 1, origin: "live", kind: "message", role: "assistant",
    content: [{type: "image", data: "AA==", mimeType: "image/png", _meta: {source: "provider"}}]}] as const
  const result = readHistory(input)
  expect(result).toEqual(input)
  expect(result).not.toBe(input)
})

test.each([
  {value: [{id: "bad", sequence: 1, origin: "live", kind: "message", role: "assistant", content: [{type: "image"}]}]},
  {value: [{id: "bad", sequence: 1, origin: "live", kind: "event", update: {sessionUpdate: "tool_call_update"}}]},
  {value: [{id: "duplicate", sequence: 1, origin: "local", kind: "turn", requestId: "r", state: "started"},
    {id: "duplicate", sequence: 2, origin: "local", kind: "turn", requestId: "r", state: "completed"}]},
  {value: [{id: "one", sequence: 2, origin: "local", kind: "turn", requestId: "r", state: "started"},
    {id: "two", sequence: 1, origin: "local", kind: "turn", requestId: "r", state: "completed"}]},
])("reader отказывает повреждённой истории %#", ({value}) => {
  expect(() => readHistory(value)).toThrow("Повреждена timeline")
})
