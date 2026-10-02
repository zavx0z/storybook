/**
Предоставляет начальные сохраняемые настройки окна MCP.
Каждый вызов возвращает новую раскладку; ответы, каталог и временные жесты
не входят в состояние. Сохранением и восстановлением настроек владеет приложение.

@packageDocumentation
*/
import type {McpWindowState} from "./contract"
export type {McpWindowState} from "./contract"

/** Начальное закрытое окно до первого сохранения пользовательских настроек. */
export default function defaultMcpWindowState(): McpWindowState.Output {
  return {open: false, mode: "agent", geometry: {x: 24, y: 24, width: 620, height: 400}}
}
