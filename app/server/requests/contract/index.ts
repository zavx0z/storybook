import type {McpRequestRecord} from "./record"

/** Контракт ограниченного журнала доставок MCP одного HTTP-сервера. */
export declare namespace StorybookAppServerRequests {
  /** Запись, независимые последние 20 обращений общего и каждого локального журнала, диагностика доставки. */
  type Output = Readonly<{
    write(value: unknown): void
    /** Без адреса читает общий журнал; адрес выбирает источник вызовов локального агента. */
    read(address?: string): readonly McpRequestRecord[]
    summary(): readonly Readonly<{
      id: string
      tool: string
      startedAt: number
      durationMs: number | null
      status: McpRequestRecord["status"]
      agentId?: string
      address?: string
      inputBytes: number
      resultBytes: number
    }>[]
  }>
}
