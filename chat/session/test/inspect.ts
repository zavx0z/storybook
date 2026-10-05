import readHistory, {type StorybookChatHistory} from "@zavx0z/storybook-chat-history"
import type {StorybookChatSession} from "../contract"

type Sessions = StorybookChatSession.Output
type Target = Parameters<Sessions["read"]>[0]
/** Только тестовый сборщик: проверяет весь архив через публичные ограниченные чтения. */
export async function inspect(sessions: Sessions, target: Target) {
  const snapshot = await sessions.read(target)
  const timeline: StorybookChatHistory.Output[number][] = []
  let after: number | undefined
  for (;;) {
    const page = await sessions.history(target, after === undefined ? {around: 0, limit: 64} : {after, limit: 64})
    for (const header of page.items) {
      const body = await sessions.historyItem(target, header.id)
      const entry = body.entry
      if (entry.kind === "message" || entry.kind === "tool") {
        const updates: unknown[] = []
        let cursor: number | undefined
        for (;;) {
          const evidence = await sessions.historyEvidence(target, header.id, cursor === undefined ? {around: 0, limit: 64} : {after: cursor, limit: 64})
          updates.push(...evidence.items)
          if (evidence.after === null) break
          cursor = evidence.after
        }
        const restored = readHistory([updates.length > 0 || entry.kind === "tool" ? {...entry, updates} : entry])[0]!
        if (restored.kind === "message" && restored.updates?.length) {
          let content: typeof restored.content[number][] = []
          let batch: string | undefined
          for (const event of restored.updates) {
            if (event.origin === "replay" && event.batchId !== batch) content = []
            content.push(event.update.content)
            batch = event.batchId
          }
          timeline.push({...restored, content})
        } else timeline.push(restored)
      } else timeline.push(entry)
    }
    if (page.after === null) break
    after = page.after
  }
  const messages = timeline.flatMap(item => item.kind === "message" && item.role !== "thought"
    && (item.content.length === 0 || item.content.some(block => block.type === "text"))
    ? [{id: item.id, role: item.role, text: item.content.map(block => block.type === "text" ? block.text : "").join("")}] : [])
  return {...snapshot, timeline, messages}
}

/** Независимое чтение committed source проверяет durable запись, а не live cache Session. */
export async function persisted(file: string) {
  const {openArchive} = await import("../src/archive")
  const header = await Bun.file(file).json()
  const archive = await openArchive(file, header.metadata)
  try {
    const view = await inspect({
      read: async () => ({...archive.metadata, history: archive.stats()}),
      history: async (_: unknown, query: unknown) => archive.page(query as Parameters<typeof archive.page>[0]),
      historyItem: async (_: unknown, id: string) => archive.body(id),
      historyEvidence: async (_: unknown, id: string, query: unknown) => archive.evidence(id, query as Parameters<typeof archive.evidence>[1]),
    } as unknown as Sessions, header.metadata.address)
    return {...archive.metadata, schemaVersion: 3, timeline: view.timeline}
  } finally { await archive.dispose() }
}
