/**
Обозначает незавершённый предметный MCP для Domain.
Ответ сохраняет выбранный адрес и явно сообщает, что возможности ещё не реализованы.
Чтение не запускает сущность и не выполняет её сценарии.

@packageDocumentation
*/
import type {StorybookDomainMcp} from "./contract"

export type {StorybookDomainMcp} from "./contract"

/**
Возвращает явную заглушку для выбранного Domain.

@param input - Канонический MCP-адрес, уже разрешённый вызывающим владельцем.
@returns Адрес и состояние незавершённой реализации Domain MCP.
*/
export default function readDomainMcp(input: StorybookDomainMcp.Input): StorybookDomainMcp.Output {
  return {
    path: input.path,
    status: "not-implemented",
    description: "Предметный MCP для Domain ещё не реализован.",
  }
}
