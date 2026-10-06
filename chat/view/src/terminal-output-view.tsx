import { useLayoutEffect, useMemo, useRef, useState } from "@zavx0z/immersive-component"
import CodeEditor from "@zavx0z/immersive-ui-component-view-code-editor"
import Button from "@zavx0z/immersive-ui-component-button-basic"
import type { HistoryTerminalPage, HistoryTerminalCursor } from "@zavx0z/storybook-chat-session"
import { readTerminalOutput, terminalSegments, type TerminalChunk } from "./terminal-output"

/** Точная occurrence либо ограниченная порция упорядоченного вывода целого инструмента. */
export default function ToolTerminal(
  props: Readonly<{
    id: string
    call: unknown
    terminal?: HistoryTerminalPage | undefined
    read?:
      | ((
          id: string,
          cursor: HistoryTerminalCursor,
          signal: AbortSignal
        ) => Promise<HistoryTerminalPage>)
      | undefined
  }>
) {
  const exact = useMemo(() => readTerminalOutput(props.call), [props.call])
  const [page, setPage] = useState<HistoryTerminalPage | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const request = useRef<AbortController | null>(null)
  useLayoutEffect(() => {
    request.current?.abort()
    setPage(undefined)
    setLoading(false)
    setError("")
    return () => request.current?.abort()
  }, [props.id, props.terminal?.revision])
  const output = page ?? props.terminal ?? exact
  const next = page?.next ?? (page === undefined ? props.terminal?.next : null)
  const chunks = useMemo(() => terminalSegments(output.chunks), [output.chunks])
  const exit = output.exit
  const completion = exit
    ? `${exit.code === null ? "Процесс завершён" : `Код завершения: ${exit.code}`}${exit.signal ? ` · Сигнал: ${exit.signal}` : ""}`
    : ""
  const load = async () => {
    if (!next || !props.read || loading) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError("")
    try {
      const result = await props.read(props.id, next, controller.signal)
      if (controller.signal.aborted || request.current !== controller) return
      if (result.id !== props.id || result.revision !== props.terminal?.revision)
        throw new Error("Вывод обновился; откройте инструмент снова")
      setPage(result)
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }
  return (
    <section data-chat-terminal="">
      {output.cwd ? <TerminalDirectory cwd={output.cwd} /> : null}
      {chunks.map((chunk, index) => (
        <TerminalChunkView key={index} chunk={chunk} />
      ))}
      {completion ? <TerminalCompletion text={completion} /> : null}
      {!chunks.length && !completion ? <TerminalWaiting /> : null}
      {error ? <TerminalError text={error} /> : null}
      {next ? (
        <Button
          label={loading ? "Загрузка…" : error ? "Повторить загрузку" : "Следующая часть вывода"}
          disabled={loading || !props.read}
          onClick={() => {
            void load()
          }}
        />
      ) : null}
      {page ? (
        <Button
          label="К началу вывода"
          onClick={() => {
            request.current?.abort()
            setPage(undefined)
            setLoading(false)
            setError("")
          }}
        />
      ) : null}
    </section>
  )
}
function TerminalChunkView(props: Readonly<{ chunk: TerminalChunk }>) {
  const label =
    props.chunk.stream === "stdout"
      ? "stdout"
      : props.chunk.stream === "stderr"
        ? "stderr"
        : "Вывод терминала"
  return (
    <div data-chat-terminal-stream={props.chunk.stream}>
      <strong>{label}</strong>
      <CodeEditor
        value={props.chunk.text}
        title={label}
        languageId="plaintext"
        readOnly={true}
        showLineNumbers={false}
        showFormattingCharacters={false}
        style={css`
          width: 100%;
          min-width: 0;
          height: auto;
          max-height: 240px;
          overflow: auto;
          user-select: contain;
        `}
      />
    </div>
  )
}
function TerminalDirectory(props: Readonly<{ cwd: string }>) {
  return <p data-chat-terminal-cwd="">{props.cwd}</p>
}
function TerminalCompletion(props: Readonly<{ text: string }>) {
  return (
    <p data-chat-terminal-exit="" role="status">
      {props.text}
    </p>
  )
}
function TerminalWaiting() {
  return <p>Вывод терминала отсутствует.</p>
}
function TerminalError(props: Readonly<{ text: string }>) {
  return <p role="alert">{props.text}</p>
}
