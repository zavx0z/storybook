import type {ContentBlock, AgentCapabilities} from "@agentclientprotocol/sdk"

/** Сохраняет штатные ContentBlock и проверяет объявленные input modalities до prompt. */
export function promptContent(
  input: string | readonly ContentBlock[],
  capabilities?: AgentCapabilities,
): ContentBlock[] {
  const content = typeof input === "string" ? [{type: "text" as const, text: input}] : structuredClone([...input])
  if (!content.length || !content.every(block => block && typeof block === "object" &&
    ["text", "image", "audio", "resource", "resource_link"].includes(block.type))) {
    throw new TypeError("ACP prompt должен содержать ContentBlock")
  }
  if (!content.some(block => block.type !== "text" || block.text.trim().length > 0)) {
    throw new TypeError("ACP prompt не может быть пустым")
  }
  if (capabilities !== undefined) {
    for (const block of content) {
      if (block.type === "image" && capabilities.promptCapabilities?.image !== true) {
        throw new Error("ACP agent не объявил поддержку image input")
      }
      if (block.type === "audio" && capabilities.promptCapabilities?.audio !== true) {
        throw new Error("ACP agent не объявил поддержку audio input")
      }
      if (block.type === "resource" && capabilities.promptCapabilities?.embeddedContext !== true) {
        throw new Error("ACP agent не объявил поддержку embedded context")
      }
    }
  }
  return content
}
