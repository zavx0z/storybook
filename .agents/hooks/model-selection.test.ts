import {describe, expect, test} from "bun:test"
import {deniedHookOutput, evaluateModelSelection} from "./model-selection"

const createThread = (tool_input: unknown) => ({tool_name: "mcp__codex_app__create_thread", tool_input})
const spawnAgent = (tool_input: unknown) => ({tool_name: "spawn_agent", tool_input})
const continueThread = (tool_input: unknown) => ({tool_name: "mcp__codex_app__send_message_to_thread", tool_input})

describe("PreToolUse выбора модели", () => {
  test("блокирует создание Codex-задачи без полного явного выбора", () => {
    expect(evaluateModelSelection(createThread({prompt: "Исправь подпись"})).kind).toBe("deny")
    expect(evaluateModelSelection(createThread({prompt: "Исправь подпись", model: "gpt-5.6-sol"})).kind).toBe("deny")
    expect(evaluateModelSelection(createThread({prompt: "Исправь подпись", thinking: "medium"})).kind).toBe("deny")
  })

  test("разрешает Codex-задачу с model и thinking", () => {
    expect(evaluateModelSelection(createThread({
      prompt: "Исправь подпись",
      model: "gpt-5.6-sol",
      thinking: "medium",
      target: {type: "projectless"},
    }))).toEqual({kind: "allow"})
  })

  test("не требует недоступные overrides у ChatGPT Work cloud", () => {
    expect(evaluateModelSelection(createThread({
      prompt: "Подготовь облачный отчёт",
      target: {type: "chatgptWorkCloud"},
    }))).toEqual({kind: "allow"})
  })

  test("требует у субагента model, reasoning_effort и ограниченный context fork", () => {
    expect(evaluateModelSelection(spawnAgent({message: "Проверь тесты"})).kind).toBe("deny")
    expect(evaluateModelSelection(spawnAgent({
      message: "Проверь тесты",
      model: "gpt-5.6-sol",
      reasoning_effort: "medium",
    })).kind).toBe("deny")
    expect(evaluateModelSelection(spawnAgent({
      message: "Проверь тесты",
      model: "gpt-5.6-sol",
      reasoning_effort: "medium",
      fork_turns: "3",
    }))).toEqual({kind: "allow"})
  })

  test("follow-up без overrides сохраняет настройки, а частичный override блокируется", () => {
    expect(evaluateModelSelection(continueThread({threadId: "thread", prompt: "Продолжай"}))).toEqual({kind: "allow"})
    expect(evaluateModelSelection(continueThread({threadId: "thread", prompt: "Продолжай", model: "gpt-5.6-sol"})).kind).toBe("deny")
    expect(evaluateModelSelection(continueThread({
      threadId: "thread",
      prompt: "Продолжай",
      model: "gpt-5.6-sol",
      thinking: "medium",
    }))).toEqual({kind: "allow"})
  })

  test("не затрагивает другие инструменты и блокирует неизвестный input целевого", () => {
    expect(evaluateModelSelection({tool_name: "mcp__storybook__storybook_status", tool_input: {}})).toEqual({kind: "allow"})
    expect(evaluateModelSelection(createThread(null)).kind).toBe("deny")
    expect(evaluateModelSelection(null).kind).toBe("deny")
  })

  test("формирует официальный deny contract PreToolUse", () => {
    expect(deniedHookOutput("Нужен явный выбор")).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Нужен явный выбор",
      },
    })
  })
})
