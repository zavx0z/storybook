/** Версии готовых оболочек для сохранённых платформ открытых страниц. */
export type Version = Readonly<{platform: string, web: string}>

/** Наблюдаемое состояние явного перевыпуска Web, общее для всех вызывающих. */
export type State = Readonly<{
  operationId: string | null
  phase: "idle" | "preparing" | "prepared" | "publishing" | "published" | "failed"
  at: string
  versions: readonly Version[]
  error: string | null
}>

/**
Сборщик предоставляет подготовку с готовой платформой, проверку результата и публикацию.
Prepared сохраняет форму владельца артефактов и не передаётся в интерфейс или MCP.
Сигнал принадлежит времени жизни приложения, а не отдельному клиенту.
*/
export type Input<Prepared> = Readonly<{
  prepare(signal: AbortSignal): Promise<Prepared>
  versions(prepared: Prepared): readonly Version[]
  publish(prepared: Prepared): void
}>

/**
Управление явной подготовкой и применением Web без остановки работающих страниц.
rebuild объединяет конкурентные запросы; apply публикует общий подготовленный результат.
subscribe сразу передаёт текущее состояние и возвращает освобождение подписки.
dispose запрещает новые операции и ждёт завершения принадлежащей работы.
*/
export type Output = Readonly<{
  rebuild(options?: Readonly<{apply?: boolean}>): Promise<State>
  read(): State
  subscribe(listener: (state: State) => void): () => void
  dispose(): Promise<void>
}>
