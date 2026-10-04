/**
Обозначает незавершённый предметный MCP для Component.
Ответ сохраняет выбранный адрес и явно сообщает, что возможности ещё не реализованы.
Чтение не запускает сущность и не выполняет её сценарии.

@packageDocumentation
*/
import type {StorybookComponentMcp} from "./contract"

export type {StorybookComponentMcp} from "./contract"

/**
Возвращает явную заглушку для выбранного Component.

@param input - Канонический MCP-адрес, уже разрешённый вызывающим владельцем.
@returns Адрес и состояние незавершённой реализации Component MCP.
*/
export default function readComponentMcp(input: StorybookComponentMcp.Input): StorybookComponentMcp.Output {
  return {
    path: input.path,
    status: "not-implemented",
    description: "Предметный MCP для Component ещё не реализован.",
  }
}
