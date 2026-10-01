import type {ServerContext} from "@modelcontextprotocol/server"

/**
Связывает уведомления о ходе одной работы с progressToken текущего MCP-запроса.
Число progress считает наблюдаемые события; total не задаётся без известного объёма работы.
Без запроса уведомлений или после отмены клиента сообщения не отправляются.
*/
export function createRequestProgress(context: Readonly<{
  mcpReq: Pick<ServerContext["mcpReq"], "_meta" | "signal" | "notify">
}>): ((message: string) => Promise<void>) | undefined {
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
