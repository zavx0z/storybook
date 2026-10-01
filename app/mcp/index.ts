/**
Предметный MCP-вход предоставляет один lazy-инструмент `storybook` и HTTP-чтение
того же каталога. Управление процессом и прочие инструменты соединяет приложение.

@packageDocumentation
*/
import {z} from "zod"
import requestStorybook from "@app-mcp/proxy"
import response from "@app-mcp/response"
import storybookRest from "@mcp/rest"
import type {AppMcp} from "./contract"

export type {AppMcp} from "./contract"

const storybookSchema = z.strictObject({
  path: z.string().min(1).max(512).regex(/^[^\u0000-\u001f\u007f]+$/u)
    .optional().describe("Адрес из path выбранного элемента children. Без параметров URL и fragment."),
})

/** Подключает только предметное чтение к предоставленному SDK server. */
function register(server: Parameters<AppMcp.Output["register"]>[0], options: AppMcp.Input = {}): void {
  server.registerTool("storybook", {
    title: "Storybook",
    description: "Открывает корневой вход Storybook MCP или направление по path. Ответ содержит назначение и children; у выбранного владельца input и output содержат JSON Schema с описаниями, а scenarios — примеры использования. Выберите направление по описанию и передайте его path следующему вызову. Пустой вызов возвращает к корню. Чтение не выполняет код. Используйте адреса из children, без параметров URL и фрагмента адреса.",
    inputSchema: storybookSchema,
    annotations: {readOnlyHint: true, idempotentHint: true},
  }, async (input, context) => {
    try {
      const execute = () => (options.request ?? requestStorybook)(input, context.mcpReq.signal)
      const result = options.traceRequest === undefined
        ? await execute()
        : await options.traceRequest("storybook", input, execute)
      return response(result)
    } catch (error) {
      return response.error(error)
    }
  })
}

/** Соединяет готовую публичную структуру с её предметным HTTP-читателем. */
function read(request: Parameters<AppMcp.Output["read"]>[0], options: Parameters<AppMcp.Output["read"]>[1]): ReturnType<AppMcp.Output["read"]> {
  return storybookRest(request, options)
}

/** Одна предметная возможность с регистрацией и REST-представлением. */
const mcp: AppMcp.Output = Object.freeze({register, read})

export default mcp
