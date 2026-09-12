type ToolInput = Readonly<Record<string, unknown>>

export type ModelSelectionDecision = Readonly<
  {kind: "allow"} |
  {kind: "deny", reason: string}
>

const createThreadNames = new Set(["mcp__codex_app__create_thread"])
const spawnAgentNames = new Set([
  "spawn_agent",
  "collaboration.spawn_agent",
  "functions.collaboration.spawn_agent",
])
const continueThreadNames = new Set(["mcp__codex_app__send_message_to_thread"])

/**
Проверяет, что создание задачи использует явно выбранные model и reasoning effort.

Hook не оценивает сложность prompt и не меняет tool input: осмысленность выбора
остаётся ответственностью делегирующего агента и проверяется человеком по задаче.
*/
export function evaluateModelSelection(event: unknown): ModelSelectionDecision {
  if (!isRecord(event) || typeof event.tool_name !== "string") {
    return deny("Не удалось определить инструмент делегирования")
  }
  const toolName = event.tool_name
  if (!createThreadNames.has(toolName) && !spawnAgentNames.has(toolName) && !continueThreadNames.has(toolName)) {
    return {kind: "allow"}
  }
  if (!isRecord(event.tool_input)) {
    return deny("Инструмент делегирования получил неизвестный tool_input")
  }
  const input = event.tool_input
  if (createThreadNames.has(toolName)) return evaluateCreateThread(input)
  if (spawnAgentNames.has(toolName)) return evaluateSpawnAgent(input)
  return evaluateThreadContinuation(input)
}

export function deniedHookOutput(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  } as const
}

function evaluateCreateThread(input: ToolInput): ModelSelectionDecision {
  const target = input.target
  if (isRecord(target) && target.type === "chatgptWorkCloud") return {kind: "allow"}
  if (!hasText(input.model) || !hasText(input.thinking)) {
    return deny("Перед созданием Codex-задачи явно выберите model и thinking по сложности, неопределённости и последствиям ошибки")
  }
  return {kind: "allow"}
}

function evaluateSpawnAgent(input: ToolInput): ModelSelectionDecision {
  if (!hasText(input.model) || !hasText(input.reasoning_effort)) {
    return deny("Перед созданием субагента явно выберите model и reasoning_effort по сложности, неопределённости и последствиям ошибки")
  }
  if (input.fork_turns === undefined || input.fork_turns === "all") {
    return deny("Явный model override субагента требует ограниченный fork_turns: none или число последних turns")
  }
  return {kind: "allow"}
}

function evaluateThreadContinuation(input: ToolInput): ModelSelectionDecision {
  const hasModel = input.model !== undefined
  const hasThinking = input.thinking !== undefined
  if (!hasModel && !hasThinking) return {kind: "allow"}
  if (!hasText(input.model) || !hasText(input.thinking)) {
    return deny("Для продолжения задачи задайте оба override — model и thinking — либо не задавайте ни одного и сохраните текущий выбор")
  }
  return {kind: "allow"}
}

function deny(reason: string): ModelSelectionDecision {
  return {kind: "deny", reason}
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

if (import.meta.main) {
  let decision: ModelSelectionDecision
  try {
    decision = evaluateModelSelection(JSON.parse(await Bun.stdin.text()))
  } catch {
    decision = deny("PreToolUse hook не смог разобрать JSON события делегирования")
  }
  if (decision.kind === "deny") console.log(JSON.stringify(deniedHookOutput(decision.reason)))
}
