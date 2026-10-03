import {agent, methods, ndJsonStream, PROTOCOL_VERSION, RequestError, type NewSessionRequest, type PromptResponse, type SessionConfigOption} from "@agentclientprotocol/sdk"
import {Readable, Writable} from "node:stream"

let input: NewSessionRequest | null = null
let cancel: ((response: PromptResponse) => void) | null = null
const behavior = process.env.ACP_FIXTURE_BEHAVIOR
let configOptions: SessionConfigOption[] = [
  {id: "model", type: "select", category: "model", name: "Model", currentValue: "model-a", options: [{value: "model-a", name: "Model A"}, {value: "model-b", name: "Model B"}]},
  {id: "effort", type: "select", category: "thought_level", name: "Thinking", currentValue: "high", options: [{value: "low", name: "Low"}, {value: "high", name: "High"}]},
]

if (process.argv.includes("cli")) {
  if (behavior === "probe-stall") await new Promise(() => {})
  process.stdout.write(JSON.stringify([
    {name: "global-fixture", enabled: true, transport: {url: "PRIVATE_VALUE_MUST_NOT_BE_RETURNED"}},
    {name: "scope-fixture", enabled: false},
  ]) + "\n")
  process.exit(0)
}

const connection = agent({name: "ACP process fixture"})
  .onRequest(methods.agent.initialize, async () => {
    if (behavior === "stall") await new Promise(() => {})
    return {protocolVersion: PROTOCOL_VERSION, agentCapabilities: {loadSession: behavior !== "no-load"}}
  })
  .onRequest(methods.agent.session.new, ({params}) => {
    if (behavior === "no-new") throw new Error("Новый контекст создавать запрещено")
    input = params
    return {sessionId: "fixture-session", ...(behavior === "settings" ? {configOptions} : {})}
  })
  .onRequest(methods.agent.session.load, async ({params, client}) => {
    input = params
    if (behavior === "load-error") throw RequestError.internalError(undefined, "Сохранённая сессия отсутствует")
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {sessionUpdate: "agent_message_chunk", content: {type: "text", text: "replayed"}},
    })
    if (behavior === "settings") await client.notify(methods.client.session.update, {
      sessionId: params.sessionId, update: {sessionUpdate: "usage_update", used: 427000, size: 828000},
    })
    return behavior === "settings" ? {configOptions} : {}
  })
  .onRequest(methods.agent.session.setConfigOption, ({params}) => {
    const selected = configOptions.find(option => option.id === params.configId)
    if (!selected || selected.type !== "select" || !selected.options.some(option => "value" in option && option.value === params.value)) throw RequestError.invalidParams()
    configOptions = configOptions.map(option => option.id === params.configId && option.type === "select" ? {...option, currentValue: params.value as string} : option)
    if (params.configId === "model" && params.value === "model-b") {
      configOptions = [configOptions[0]!, {id: "effort", type: "select", category: "thought_level", name: "Thinking", currentValue: "low", options: [{value: "low", name: "Low"}]}]
    }
    return {configOptions}
  })
  .onRequest(methods.agent.session.prompt, async ({params, client}) => {
    const text = params.prompt.find(block => block.type === "text")
    const message = text?.type === "text" ? text.text : ""
    if (message === "crash") process.exit(42)
    if (message === "permission") {
      const result = await client.request(methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: {toolCallId: "fixture-tool", title: "Проверка решения пользователя"},
        options: [{optionId: "deny", name: "Отказать", kind: "reject_once"}],
      })
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {sessionUpdate: "agent_message_chunk", content: {type: "text", text: JSON.stringify(result)}},
      })
      return {stopReason: "end_turn"}
    }
    await client.notify(methods.client.session.update, {
      sessionId: behavior === "foreign" ? "another-session" : params.sessionId,
      update: {sessionUpdate: "agent_message_chunk", content: {type: "text", text: JSON.stringify({
        input,
        text: message,
        mode: process.env.INITIAL_AGENT_MODE,
        config: process.env.CODEX_CONFIG === undefined ? null : JSON.parse(process.env.CODEX_CONFIG),
        ...(process.env.DISABLE_MCP_CONFIG_FILTERING === undefined ? {} : {filtering: process.env.DISABLE_MCP_CONFIG_FILTERING}),
        ...(message !== "env" ? {} : {
          parentContext: [
            "CODEX_APP_TOOLS_PIPE_PATH",
            "CODEX_THREAD_ID",
            "CODEX_SESSION_ID",
            "CODEX_TASK_WORKSPACE_VERIFYING_IDENTITY",
            "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
          ].filter(name => process.env[name] !== undefined),
          permissionProfile: process.env.CODEX_PERMISSION_PROFILE,
        }),
      })}},
    })
    if (message === "wait") return await new Promise<PromptResponse>(resolve => { cancel = resolve })
    return {stopReason: "end_turn"}
  })
  .onNotification(methods.agent.session.cancel, () => {
    cancel?.({stopReason: "cancelled"})
    cancel = null
  })
  .connect(ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin) as unknown as Parameters<typeof ndJsonStream>[1],
  ))

void connection.closed.then(() => process.exit(0))
