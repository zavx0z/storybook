/** Caller-specific event stream reader обязан полностью дренировать переданный pipe. */
export type OwnedChildStdoutReader = (stream: unknown) => Promise<string>

/** Минимальный exact handle, который owner получает непосредственно от `Bun.spawn`. */
export type OwnedChildHandle = Readonly<{
  pid: number
  exited: Promise<number>
  stdout: unknown
  stderr: unknown
  kill(signal?: number): unknown
}>
