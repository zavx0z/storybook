/**
Обозначает незавершённый предметный MCP для Container.
Ответ сохраняет выбранный адрес и явно сообщает, что возможности ещё не реализованы.
Чтение не запускает сущность и не выполняет её сценарии.

@packageDocumentation
*/
import type {StorybookContainerMcp} from "./contract"

export type {StorybookContainerMcp} from "./contract"

/**
Возвращает явную заглушку для выбранного Container.

@param input - Канонический MCP-адрес, уже разрешённый вызывающим владельцем.
@returns Адрес и состояние незавершённой реализации Container MCP.
*/
export default function readContainerMcp(input: StorybookContainerMcp.Input): StorybookContainerMcp.Output {
  return {
    path: input.path,
    status: "not-implemented",
    description: "Предметный MCP для Container ещё не реализован.",
  }
}
