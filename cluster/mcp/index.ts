/**
Обозначает незавершённый предметный MCP для Cluster.
Ответ сохраняет выбранный адрес и явно сообщает, что возможности ещё не реализованы.
Чтение не запускает сущность и не выполняет её сценарии.

@packageDocumentation
*/
import type {StorybookClusterMcp} from "./contract"

export type {StorybookClusterMcp} from "./contract"

/**
Возвращает явную заглушку для выбранного Cluster.

@param input - Канонический MCP-адрес, уже разрешённый вызывающим владельцем.
@returns Адрес и состояние незавершённой реализации Cluster MCP.
*/
export default function readClusterMcp(input: StorybookClusterMcp.Input): StorybookClusterMcp.Output {
  return {
    path: input.path,
    status: "not-implemented",
    description: "Предметный MCP для Cluster ещё не реализован.",
  }
}
