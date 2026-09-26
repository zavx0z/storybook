import type {TraceLocation} from "./types"

const sources = new Map<string, Map<number, {column: number, length: number}[]>>()

/** Учитывает однострочные вставки инструментации, отсутствующие в исходном файле. */
export function registerInsertions(path: string, source: string, insertions: readonly {position: number, text: string}[]): void {
  const lines = new Map<number, {column: number, length: number}[]>()
  for (const insertion of insertions) {
    const prefix = source.slice(0, insertion.position)
    const line = prefix.split("\n").length
    const entries = lines.get(line) ?? []
    entries.push({column: prefix.length - prefix.lastIndexOf("\n"), length: insertion.text.length})
    lines.set(line, entries)
  }
  for (const entries of lines.values()) entries.sort((a, b) => a.column - b.column)
  sources.set(path, lines)
}

/** Возвращает координату оригинального текста вместо колонки с добавленным наблюдением. */
export function sourceLocation(location: TraceLocation): TraceLocation {
  let offset = 0
  for (const insertion of sources.get(location.path)?.get(location.line) ?? []) {
    if (insertion.column + offset >= location.column) break
    if (insertion.column + offset + insertion.length > location.column) return {...location, column: insertion.column}
    offset += insertion.length
  }
  return {...location, column: location.column - offset}
}
