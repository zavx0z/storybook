import type {McpRequestRecord} from "@mcp/rest/requests"

/** Выбирает одну целую команду; отсутствие выбора означает слежение за последней. */
export function selectRequest(entries: readonly McpRequestRecord[], selectedId: string | null) {
  const index = Math.max(0, selectedId === null ? 0 : entries.findIndex(entry => entry.id === selectedId))
  return {
    entry: entries[index] ?? null,
    index,
    olderId: entries[index + 1]?.id ?? null,
    newerId: entries[index - 1]?.id ?? null,
  }
}
