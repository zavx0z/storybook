import type {PrepareInput, Target} from "./target"

export declare namespace WebPageTarget {
  /** Операции чтения trusted bootstrap и запроса server-owned цели перехода. */
  export type Output = Readonly<{
    /** Читает JSON из серверного HTML, не исполняя runtime и не выбирая ревизию. */
    read(document: globalThis.Document): Target
    /** Запрашивает серверное разрешение цели; signal отменяет транспорт. */
    prepare(fetcher: typeof fetch, input: PrepareInput, signal: AbortSignal): Promise<Target>
  }>
}
