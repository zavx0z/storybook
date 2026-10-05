import {expect, test} from "bun:test"
import {mkdtemp, readFile, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createSessions, {type StorybookChatSession} from "../index"

test("timeline сохраняет границы сообщений, tools, context, media и stopReason; JSON имеет один источник", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chat-rich-history-"))
  let supplied: unknown
  const sessions = createSessions({
    directory: () => directory,
    resolve: address => ({address, label: "История", cwd: directory}),
    async connect(input) {
      return {
        sessionId: "provider-session", capabilities: {promptCapabilities: {image: true, embeddedContext: true}}, configOptions: [],
        async setConfigOption() { return [] },
        async prompt(content) {
          supplied = content
          await input.onUpdate({sessionUpdate: "agent_message_chunk", messageId: "before", content: {type: "text", text: "Перед инструментом"}, _meta: {phase: "commentary"}})
          await input.onUpdate({sessionUpdate: "tool_call", toolCallId: "tool", title: "Чтение", status: "in_progress", rawInput: {path: "file"}})
          await input.onUpdate({sessionUpdate: "tool_call_update", toolCallId: "tool", status: "completed", rawOutput: {text: "result"}, content: [{type: "content", content: {type: "text", text: "Результат"}}]})
          await input.onUpdate({sessionUpdate: "agent_message_chunk", messageId: "after", content: {type: "image", mimeType: "image/png", data: "AA=="}})
          await input.onUpdate({sessionUpdate: "agent_thought_chunk", messageId: "thought", content: {type: "text", text: "Предоставленное рассуждение"}})
          return {stopReason: "end_turn"}
        },
        async cancel() {}, async dispose() {},
      }
    },
  })
  try {
    const content: Extract<Awaited<ReturnType<StorybookChatSession.Output["read"]>>["timeline"][number], {kind: "message"}>["content"] = [
      {type: "text", text: "Прочитай"},
      {type: "image", mimeType: "image/png", data: "AA=="},
      {type: "resource", resource: {uri: "context://subject", mimeType: "text/plain", text: "Предоставленный контекст"}},
    ]
    const done = Promise.withResolvers<void>()
    const unsubscribe = await sessions.subscribe("/", value => {
      if (value.status === "idle" && value.timeline.some(item => item.kind === "turn" && item.state === "completed")) done.resolve()
    })
    await sessions.prompt("/", content, "rich")
    await done.promise
    unsubscribe()
    const actual = await sessions.read("/")
    expect(supplied).toEqual(content)
    expect(actual.timeline.map(item => item.kind)).toEqual(["message", "context", "turn", "message", "tool", "message", "message", "turn"])
    const tool = actual.timeline.find(item => item.kind === "tool")
    expect(tool?.kind === "tool" ? tool.call : null).toMatchObject({status: "completed", rawInput: {path: "file"}, rawOutput: {text: "result"}})
    expect(tool?.kind === "tool" ? tool.updates.map(event => event.update.sessionUpdate) : []).toEqual(["tool_call", "tool_call_update"])
    expect(actual.messages.map(item => item.text)).toEqual(["Прочитай", "Перед инструментом"])
    expect(actual.timeline.at(-1)).toMatchObject({kind: "turn", state: "completed", stopReason: "end_turn"})
    const fs = await import("node:fs/promises")
    const file = (await fs.readdir(directory)).find(name => name.endsWith(".json"))!
    const stored = JSON.parse(await readFile(join(directory, file), "utf8"))
    expect(stored.schemaVersion).toBe(2)
    expect(stored.messages).toBeUndefined()
    expect(stored.timeline).toEqual(actual.timeline)
  } finally {
    await sessions.dispose()
    await rm(directory, {recursive: true, force: true})
  }
})
