import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {agent, methods, PROTOCOL_VERSION, type AnyMessage, type PromptResponse, type SessionConfigOption, type SessionUpdate} from "@agentclientprotocol/sdk"
import createAcp, {type StorybookTechAcp} from "../index"

/** Две стороны публичного ACP SDK в памяти, без запуска процесса или CLI probe. */
function fixture(options: {foreign?: boolean, noLoad?: boolean, stallInitialize?: boolean} = {}) {
  const input = new TransformStream<AnyMessage, AnyMessage>()
  const output = new TransformStream<AnyMessage, AnyMessage>()
  const calls: {method: string, params: unknown}[] = []
  let disposeCalls = 0
  let releaseClosed!: () => void
  let rejectClosed!: (reason: Error) => void
  const closed = new Promise<void>((resolve, reject) => {
    releaseClosed = resolve
    rejectClosed = reject
  })
  void closed.catch(() => {})
  let started!: () => void
  const prompting = new Promise<void>(resolve => {started = resolve})
  let cancel!: (result: PromptResponse) => void
  let configOptions: SessionConfigOption[] = [{id: "model", name: "Model", type: "select", currentValue: "a", options: [{value: "a", name: "A"}, {value: "b", name: "B"}]}]
  const sdk = agent({name: "owned-stream-fixture"})
    .onRequest(methods.agent.initialize, async ({params}) => {
      calls.push({method: "initialize", params})
      if (options.stallInitialize) await new Promise<void>(() => {})
      return {protocolVersion: PROTOCOL_VERSION, agentCapabilities: {
        loadSession: options.noLoad !== true, sessionCapabilities: {resume: {}}, promptCapabilities: {image: true},
      }}
    })
    .onRequest(methods.agent.session.new, ({params}) => {
      calls.push({method: "session/new", params})
      return {sessionId: "native-stream-session", configOptions}
    })
    .onRequest(methods.agent.session.load, async ({params, client}) => {
      calls.push({method: "session/load", params})
      await client.notify(methods.client.session.update, {sessionId: params.sessionId,
        update: {sessionUpdate: "agent_message_chunk", content: {type: "text", text: "replay"}}})
      return {configOptions}
    })
    .onRequest(methods.agent.session.resume, ({params}) => {
      calls.push({method: "session/resume", params})
      return {configOptions}
    })
    .onRequest(methods.agent.session.setConfigOption, ({params}) => {
      calls.push({method: "session/set_config_option", params})
      configOptions = configOptions.map(option => option.type === "select" ? {...option, currentValue: String(params.value)} : option)
      return {configOptions}
    })
    .onRequest(methods.agent.session.prompt, async ({params, client}) => {
      calls.push({method: "session/prompt", params})
      const text = params.prompt.find(block => block.type === "text")
      if (text?.type === "text" && text.text === "wait") {
        const pending = new Promise<PromptResponse>(resolve => {cancel = resolve})
        started()
        return pending
      }
      if (text?.type === "text" && text.text === "permission") {
        const permission = await client.request(methods.client.session.requestPermission, {
          sessionId: params.sessionId, toolCall: {toolCallId: "tool"},
          options: [{optionId: "deny", name: "Deny", kind: "reject_once"}],
        })
        calls.push({method: "permission-result", params: permission})
      }
      await client.notify(methods.client.session.update, {sessionId: options.foreign ? "foreign" : params.sessionId,
        update: {sessionUpdate: "agent_message_chunk", content: {type: "text", text: "streamed"}}})
      return {stopReason: "end_turn"}
    })
    .onNotification(methods.agent.session.cancel, ({params}) => {
      calls.push({method: "session/cancel", params})
      cancel?.({stopReason: "cancelled"})
    })
    .connect({readable: input.readable, writable: output.writable})
  const ownedStream: NonNullable<StorybookTechAcp.Input["ownedStream"]> = {
    stream: {readable: output.readable, writable: input.writable}, closed,
    async dispose() {
      disposeCalls++
      cancel?.({stopReason: "cancelled"})
      sdk.close()
      releaseClosed()
    },
  }
  return {ownedStream, calls, prompting, disposeCalls: () => disposeCalls,
    lose() {rejectClosed(new Error("peer link lost"))},
  }
}

/** Общий публичный вход сохраняет локальное назначение независимо от transport. */
function input(ownedStream: NonNullable<StorybookTechAcp.Input["ownedStream"]>, overrides: Partial<StorybookTechAcp.Input> = {}): StorybookTechAcp.Input {
  return {cwd: resolve(import.meta.dir, "../../.."), agentCwd: "/remote/assigned", ownedStream, mcpServers: [],
    onUpdate() {}, async onPermission() {return {outcome: {outcome: "selected", optionId: "deny"}}}, ...overrides}
}

test("owned SDK stream keeps lifecycle, live updates, settings and permissions", async () => {
  const f = fixture()
  const phases: string[] = []
  const updates: SessionUpdate[] = []
  const connection = await createAcp(input(f.ownedStream, {onProgress: phase => {phases.push(phase)}, onUpdate: value => {updates.push(value)}}))
  try {
    expect(connection.sessionId).toBe("native-stream-session")
    expect(phases).toEqual(["initialize", "session", "ready"])
    expect(f.calls.find(call => call.method === "session/new")?.params).toEqual({cwd: "/remote/assigned", mcpServers: []})
    expect(connection.capabilities.promptCapabilities?.image).toBeTrue()
    expect((await connection.setConfigOption("model", "b"))[0]?.currentValue).toBe("b")
    expect((await connection.prompt("permission")).stopReason).toBe("end_turn")
    expect(f.calls.find(call => call.method === "permission-result")?.params).toEqual({outcome: {outcome: "selected", optionId: "deny"}})
    expect(updates).toEqual([{sessionUpdate: "agent_message_chunk", content: {type: "text", text: "streamed"}}])
    await connection.prompt("second turn")
    expect(f.calls.filter(call => call.method === "initialize")).toHaveLength(1)
  } finally {await connection.dispose()}
  expect(connection.dispose()).toBe(connection.dispose())
  expect(f.disposeCalls()).toBe(1)
})

test("owned stream cancellation uses session/cancel and waits for the prompt result", async () => {
  const f = fixture()
  const connection = await createAcp(input(f.ownedStream))
  try {
    const prompt = connection.prompt("wait")
    await f.prompting
    await connection.cancel()
    expect(await prompt).toEqual({stopReason: "cancelled"})
    expect(f.calls.filter(call => call.method === "session/cancel")).toHaveLength(1)
  } finally {await connection.dispose()}
})

test.each([false, true])("explicit load/resume preserves native session identity, preferResume=%s", async preferResume => {
  const f = fixture()
  const replay: SessionUpdate[] = []
  const live: SessionUpdate[] = []
  const connection = await createAcp(input(f.ownedStream, {previousSessionId: "saved", preferResume,
    onReplay: update => {replay.push(update)}, onUpdate: update => {live.push(update)}}))
  try {
    expect(connection.sessionId).toBe("saved")
    expect(f.calls.some(call => call.method === (preferResume ? "session/resume" : "session/load"))).toBeTrue()
    expect(f.calls.some(call => call.method === "session/new")).toBeFalse()
    expect(replay).toHaveLength(preferResume ? 0 : 1)
    expect(live).toHaveLength(0)
  } finally {await connection.dispose()}
})

test("owned transport loss rejects pending prompt, releases it and does not replay", async () => {
  const f = fixture()
  const connection = await createAcp(input(f.ownedStream))
  const prompt = connection.prompt("wait").then(() => undefined, error => error)
  await f.prompting
  f.lose()
  expect((await prompt).message).toBe("peer link lost")
  await connection.dispose()
  expect(f.disposeCalls()).toBe(1)
  expect(f.calls.filter(call => call.method === "session/prompt")).toHaveLength(1)
})

test("foreign session update fails the same owned connection", async () => {
  const f = fixture({foreign: true})
  const connection = await createAcp(input(f.ownedStream))
  try {await expect(connection.prompt("foreign")).rejects.toThrow("другой сессии")}
  finally {await connection.dispose()}
})

test("failed restore releases owned stream once without creating a new session", async () => {
  const f = fixture({noLoad: true})
  await expect(createAcp(input(f.ownedStream, {previousSessionId: "saved"}))).rejects.toThrow("session/load")
  expect(f.disposeCalls()).toBe(1)
  expect(f.calls.some(call => call.method === "session/new")).toBeFalse()
})

test("abort during initialize releases owned stream once", async () => {
  const f = fixture({stallInitialize: true})
  const controller = new AbortController()
  const pending = createAcp(input(f.ownedStream, {signal: controller.signal})).then(() => undefined, error => error)
  await new Promise(resolve => setTimeout(resolve, 0))
  controller.abort(new Error("cancelled startup"))
  expect((await pending).message).toBe("cancelled startup")
  expect(f.disposeCalls()).toBe(1)
})

test.each([
  {command: "must-not-spawn"}, {adapter: "must-not-resolve"}, {args: []}, {argsForEnv: () => []},
  {env: {}}, {mode: "read-only" as const}, {config: {}}, {exclusiveMcp: false}, {installation: "/must-not-read"},
])("owned stream rejects process-only options before taking ownership: %j", async override => {
  const f = fixture()
  try {
    await expect(createAcp(input(f.ownedStream, override))).rejects.toThrow("process option")
    expect(f.calls).toHaveLength(0)
    expect(f.disposeCalls()).toBe(0)
  } finally {await f.ownedStream.dispose()}
})

test("owned stream retains local assignment directory validation", async () => {
  const f = fixture()
  try {
    await expect(createAcp(input(f.ownedStream, {cwd: "/directory-that-does-not-exist-for-acp"}))).rejects.toThrow()
    expect(f.calls).toHaveLength(0)
    expect(f.disposeCalls()).toBe(0)
  } finally {await f.ownedStream.dispose()}
})
