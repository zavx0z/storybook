import type {McpRequestRecord} from "./record"

/** Контракт ограниченного журнала доставок MCP одного HTTP-сервера. */
export declare namespace StorybookAppServerRequests {
  /** Запись, чтение последних 20 обращений и компактная диагностика доставки. */
  type Output = Readonly<{
    write(value: unknown): void
    read(): readonly McpRequestRecord[]
    summary(): readonly Readonly<{
      id: string
      tool: string
      startedAt: number
      durationMs: number | null
      status: McpRequestRecord["status"]
      inputBytes: number
      resultBytes: number
    }>[]
  }>
}
