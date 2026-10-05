import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"

type Snapshot = Awaited<ReturnType<StorybookChatSession.Output["read"]>>
type Content = Extract<Snapshot["timeline"][number], {kind: "message"}>["content"][number]

/**
Границы текстовых дельт ACP не являются границами абзацев Markdown.
Объединяет соседние текстовые блоки только для отображения, сохраняя порядок
мультимедиа и исходную историю вместе с metadata каждого транспортного блока.
*/
export function messageContent(content: readonly Content[]): readonly Content[] {
  const result: Content[] = []
  let texts: string[] = []
  let first: Extract<Content, {type: "text"}> | undefined
  const flush = () => {
    if (!first) return
    result.push(texts.length === 1 ? first : {...first, text: texts.join("")})
    texts = []
    first = undefined
  }
  for (const block of content) {
    if (block.type === "text") {
      first ??= block
      texts.push(block.text)
    } else {
      flush()
      result.push(block)
    }
  }
  flush()
  return result
}
