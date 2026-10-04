/**
Обозначает незавершённый предметный MCP для Repo.
Ответ сохраняет выбранный адрес и явно сообщает, что возможности ещё не реализованы.
Чтение не запускает сущность и не выполняет её сценарии.

@packageDocumentation
*/
import type {StorybookRepoMcp} from "./contract"

export type {StorybookRepoMcp} from "./contract"

/**
Возвращает явную заглушку для выбранного Repo.

@param input - Канонический MCP-адрес, уже разрешённый вызывающим владельцем.
@returns Адрес и состояние незавершённой реализации Repo MCP.
*/
export default function readRepoMcp(input: StorybookRepoMcp.Input): StorybookRepoMcp.Output {
  return {
    path: input.path,
    status: "not-implemented",
    description: "Предметный MCP для Repo ещё не реализован.",
  }
}
