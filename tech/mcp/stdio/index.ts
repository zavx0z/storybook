/**
Обслуживает stdio MCP-соединение, диагностику stderr и завершение по сигналам
процесса. Состав инструментов и предметный сервер предоставляет вызывающий код.

@packageDocumentation
*/
import {serveStdio} from "@modelcontextprotocol/server/stdio"
import type {Zavx0zStorybookTechMcpStdio} from "./contract"

export type {Zavx0zStorybookTechMcpStdio} from "./contract"

/**
Подключает один сервер к stdio и закрывает его при SIGINT или SIGTERM.

@param input - Фабрика сервера и метка диагностик согласно {@link Zavx0zStorybookTechMcpStdio.Input}.
@returns Управление соединением согласно {@link Zavx0zStorybookTechMcpStdio.Output}; сообщение `ready`
записывается в stderr после передачи сервера SDK.
*/
export default function serveMcpStdio(input: Zavx0zStorybookTechMcpStdio.Input): Zavx0zStorybookTechMcpStdio.Output {
  /** Ограничивает одну строку stderr, не нарушая MCP-протокол в stdout. */
  const diagnostic = (value: string): void => {
    const bounded = String(value).replace(/[\r\n]+/gu, " ").slice(0, 4_096)
    process.stderr.write(`[${input.diagnosticLabel}] ${bounded}\n`)
  }
  const handle = serveStdio(input.createServer, {onerror: error => diagnostic(error.message)})
  diagnostic("ready")
  let closing: Promise<void> | null = null
  /** Снимает signal handlers и разделяет одно ожидание закрытия transport. */
  const close = (): Promise<void> => {
    if (closing !== null) return closing
    process.removeListener("SIGINT", onInterrupt)
    process.removeListener("SIGTERM", onTerminate)
    closing = handle.close()
    return closing
  }
  /** Завершает процесс после закрытия stdio по сигналу прерывания. */
  const onInterrupt = (): void => { void close().finally(() => process.exit(130)) }
  /** Завершает процесс после закрытия stdio по сигналу завершения. */
  const onTerminate = (): void => { void close().finally(() => process.exit(143)) }
  process.once("SIGINT", onInterrupt)
  process.once("SIGTERM", onTerminate)
  return Object.freeze({close})
}
