import type {State, Version} from "./release"

/** Публичные формы управления выпуском Web; подготовленный объект остаётся у сборщика. */
export declare namespace AppWeb {
  /**
  Сборщик предоставляет подготовку с готовой платформой, проверку результата и публикацию.
  Prepared сохраняет форму владельца артефактов и не передаётся в интерфейс или MCP.
  Сигнал принадлежит времени жизни приложения, а не отдельному клиенту.
  */
  type Input<Prepared> = Readonly<{
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
  type Output = Readonly<{
    rebuild(options?: Readonly<{apply?: boolean}>): Promise<State>
    read(): State
    subscribe(listener: (state: State) => void): () => void
    dispose(): Promise<void>
  }>
}
