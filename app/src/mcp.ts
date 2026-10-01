/**
Частный адаптер управляющих MCP-вызовов приложения Storybook.
Соединяет существующий MCP-сервер с явной пересборкой собственного Web через
ту же операцию контроллера, которую использует browser-вход приложения.
Предметный lazy-вызов сохраняет свой HTTP-прокси и не загружает контроллер.
*/
import {z} from "zod"
import {createStorybookMcpServer, type CreateStorybookMcpServerInput} from "../../mcp/server"
import {controllerAccessor} from "../../mcp/server/src/controller.ts"
import {invoke} from "../../mcp/server/src/invoke.ts"
import {createRequestProgress} from "../../tech/mcp/progress.ts"

/** Добавляет явное управление Web к существующему серверу с отложенным контроллером. */
export function createAppMcpServer(options: CreateStorybookMcpServerInput = {}) {
  const server = createStorybookMcpServer(options)
  const controller = controllerAccessor(options)
  server.registerTool("storybook_rebuild_web", {
    title: "Пересборка интерфейса Storybook",
    description: "Явно пересобирает собственный Web-интерфейс в готовой среде. При live=true публикует результат для HMR всех вкладок. Передаёт реальные стадии текущего запроса; завершение подготовки не подтверждает применение во всех представлениях.",
    inputSchema: z.strictObject({
      live: z.boolean().optional(),
      timeoutMs: z.number().int().min(100).max(120_000).optional(),
    }),
  }, async (input, context) => {
    const notify = createRequestProgress(context)
    return invoke(controller, value => value.check({
      schemaVersion: 1,
      scope: "storybook:web",
      live: input.live ?? true,
      ...(input.timeoutMs === undefined ? {} : {timeoutMs: input.timeoutMs}),
    }, {
      signal: context.mcpReq.signal,
      ...(notify === undefined ? {} : {onProgress: progress => notify(JSON.stringify(progress))}),
    }))
  })
  return server
}
