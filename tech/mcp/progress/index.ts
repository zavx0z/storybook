/**
Уведомляет клиента MCP о стадиях только при наличии progressToken.

@packageDocumentation
*/
import type {McpProgress} from "./contract"

export type {McpProgress} from "./contract"

/**
Связывает уведомления о ходе одной работы с progressToken текущего MCP-запроса.
Число progress считает наблюдаемые события; total не задаётся без известного объёма работы.
Без запроса уведомлений или после отмены клиента сообщения не отправляются.

@param context - Контекст {@link McpProgress.Input} текущего запроса SDK.
@returns Callback согласно {@link McpProgress.Output} либо `undefined` при
отсутствии progressToken; каждое сообщение ждёт завершения SDK `notify`.
@throws Ошибка отправки уведомления отклоняет Promise callback.
*/
export default function createRequestProgress(context: McpProgress.Input): McpProgress.Output {
  const progressToken = context.mcpReq._meta?.progressToken
  if (typeof progressToken !== "string" && typeof progressToken !== "number") return undefined
  let progress = 0
  return async message => {
    if (context.mcpReq.signal.aborted) return
    progress += 1
    await context.mcpReq.notify({
      method: "notifications/progress",
      params: {progressToken, progress, message},
    })
  }
}
