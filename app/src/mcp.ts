/**
Частный адаптер управляющих MCP-вызовов приложения Storybook.
Соединяет существующий MCP-сервер с явной пересборкой собственного Web через
ту же операцию контроллера, которую использует browser-вход приложения.
Эта фабрика исполняется в свежем lazy-worker; постоянный stdio-транспорт
не импортирует регистрации, схемы или контроллер приложения.
*/
import {z} from "zod"
import {createStorybookMcpServer} from "./mcp/index"
import type {CreateStorybookMcpServerInput} from "./mcp/contract/input"

/** Добавляет явное управление Web к существующему серверу с отложенным контроллером. */
export function createAppMcpServer(options: CreateStorybookMcpServerInput = {}) {
  return createStorybookMcpServer({
    ...options,
    registerTools(server, execute) {
      options.registerTools?.(server, execute)
      server.registerTool("storybook_rebuild_web", {
        title: "Пересборка интерфейса Storybook",
        description: "Явно пересобирает собственный Web-интерфейс в готовой среде. При live=true публикует результат для HMR всех вкладок. Передаёт реальные стадии текущего запроса; завершение подготовки не подтверждает применение во всех представлениях.",
        inputSchema: z.strictObject({
          live: z.boolean().optional(),
          timeoutMs: z.number().int().min(100).max(120_000).optional(),
        }),
      }, (input, context) => execute((value, operationContext) => value.check({
        schemaVersion: 1,
        scope: "storybook:web",
        live: input.live ?? true,
        ...(input.timeoutMs === undefined ? {} : {timeoutMs: input.timeoutMs}),
      }, operationContext), context))
    },
  })
}

/** Точка загрузки полного сервера в изолированном исполнителе одного запроса. */
export default createAppMcpServer
