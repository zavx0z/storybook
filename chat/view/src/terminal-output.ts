/** Только структурированные поля терминального протокола; текст рассуждений не задаёт состояние. */
export type TerminalChunk = Readonly<{stream: "stdout" | "stderr" | "combined"; text: string}>
export type TerminalOutput = Readonly<{
  known: boolean
  chunks: readonly TerminalChunk[]
  cwd?: string
  terminalId?: string
  exit?: Readonly<{code: number | null; signal: string | null}>
}>
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
export function readTerminalOutput(call: unknown): TerminalOutput {
  const tool = object(call)
  const meta = object(tool?._meta)
  const delta = object(meta?.terminal_output_delta)
  const info = object(meta?.terminal_info)
  const exit = object(meta?.terminal_exit)
  const raw = object(tool?.rawOutput)
  const chunks: TerminalChunk[] = []
  if (typeof delta?.data === "string") chunks.push({stream: delta.stream === "stdout" || delta.stream === "stderr" ? delta.stream : "combined", text: delta.data})
  // stdout/stderr из полного результата показываем только когда этот occurrence не несёт delta.
  if (!chunks.length) {
    if (typeof raw?.stdout === "string") chunks.push({stream: "stdout", text: raw.stdout})
    if (typeof raw?.stderr === "string") chunks.push({stream: "stderr", text: raw.stderr})
  }
  const code = exit?.exit_code ?? raw?.exit_code ?? raw?.exitCode
  const signal = exit?.signal ?? raw?.signal
  const id = delta?.terminal_id ?? info?.terminal_id ?? exit?.terminal_id
  const hasTerminalContent = Array.isArray(tool?.content) && tool.content.some(value => object(value)?.type === "terminal")
  const known = !!delta || !!info || !!exit || chunks.length > 0 || hasTerminalContent || Number.isInteger(code)
  return {known, chunks,
    ...(typeof info?.cwd === "string" ? {cwd: info.cwd} : {}),
    ...(typeof id === "string" ? {terminalId: id} : {}),
    ...(exit || Number.isInteger(code) || typeof signal === "string" ? {exit: {code: Number.isInteger(code) ? Number(code) : null, signal: typeof signal === "string" ? signal : null}} : {})}
}

/** Соседние delta одного канала соединяются только внутри текущей ограниченной порции. */
export function terminalSegments(chunks: readonly TerminalChunk[]): readonly TerminalChunk[] {
  const segments: {stream: TerminalChunk["stream"]; text: string}[] = []
  for (const chunk of chunks) {
    const last = segments.at(-1)
    if (last?.stream === chunk.stream) last.text += chunk.text
    else segments.push({...chunk})
  }
  return segments
}
