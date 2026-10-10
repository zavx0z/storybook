import type {TraceLocation} from "./types"

const sources = new Map<string, Map<number, {column: number, length: number}[]>>()
type SourceRange = Readonly<{generatedStart: number; generatedEnd: number; sourceStart: number}>
const compiled = new Map<string, Readonly<{source: string; code: string; ranges: readonly SourceRange[]}>>()

/** Компилятор сообщает сохранённые участки текста после instrumentation, без поиска похожих строк. */
export function registerCompiledSource(path: string, source: string, code: string, ranges: readonly SourceRange[], insertionPath = path): void {
  compiled.set(path, {source, code, ranges})
  const insertions = sources.get(insertionPath)
  if (insertions !== undefined) sources.set(path, insertions)
}

function offsetAt(source: string, line: number, column: number): number | null {
  let start = 0
  for (let current = 1; current < line; current++) {
    const end = source.indexOf("\n", start)
    if (end < 0) return null
    start = end + 1
  }
  const end = source.indexOf("\n", start)
  const offset = start + column - 1
  return column < 1 || offset > (end < 0 ? source.length : end) ? null : offset
}

function originalLocation(location: TraceLocation): TraceLocation | null {
  const entry = compiled.get(location.path)
  if (entry === undefined) return location
  const offset = offsetAt(entry.code, location.line, location.column)
  if (offset === null) return null
  const range = entry.ranges.find(range => range.generatedStart <= offset && offset < range.generatedEnd)
  if (range === undefined) return null
  const sourceOffset = range.sourceStart + offset - range.generatedStart
  const prefix = entry.source.slice(0, sourceOffset)
  return {...location, line: prefix.split("\n").length, column: prefix.length - prefix.lastIndexOf("\n")}
}

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
export function sourceLocation(compiledLocation: TraceLocation): TraceLocation | null {
  const location = originalLocation(compiledLocation)
  if (location === null) return null
  let offset = 0
  for (const insertion of sources.get(location.path)?.get(location.line) ?? []) {
    if (insertion.column + offset >= location.column) break
    if (insertion.column + offset + insertion.length > location.column) return {...location, column: insertion.column}
    offset += insertion.length
  }
  return {...location, column: location.column - offset}
}
