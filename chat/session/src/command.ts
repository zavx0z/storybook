import type {StorybookChatHistory} from "@zavx0z/storybook-chat-history"
import type {Command} from "../contract/environment"

/** Распознаёт только полное текстовое сообщение, без fenced examples и примеси медиа. */
export default function readCommand(content: Extract<StorybookChatHistory.Output[number], {kind: "message"}>["content"]): Command | null {
  if (!content.length || content.some(block => block.type !== "text")) return null
  const text = content.map(block => block.type === "text" ? block.text : "").join("").trim()
  if (!text.startsWith("{")) return null
  let value: unknown
  try { value = JSON.parse(text) } catch { return null }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null
  const command = value as Record<string, unknown>
  if (Object.keys(command).length !== 2 || typeof command.name !== "string" || !command.name.trim() ||
    command.arguments === null || typeof command.arguments !== "object" || Array.isArray(command.arguments)) return null
  return command as Command
}
