/**
Предметный MCP-вход предоставляет один lazy-инструмент `storybook` и HTTP-чтение
того же каталога. Полный native MCP-сервер соединяет его с управлением.
*/
import {z} from "zod"
import requestStorybook from "@zavx0z/storybook-app-mcp-proxy"
import response from "@zavx0z/storybook-app-mcp-response"
import storybookRest from "@zavx0z/storybook-app-mcp-rest"
import type {StorybookAppMcp} from "../contract"

const storybookSchema = z.strictObject({
  path: z.string().min(1).max(514).regex(/^[^\u0000-\u001f\u007f]+$/u)
    .optional().describe("Адрес из children относительно неизменной точки входа root. Без параметров URL и fragment."),
})

/** Подключает только предметное чтение к предоставленному SDK server. */
export function register(server: Parameters<StorybookAppMcp.Output["register"]>[0], options: StorybookAppMcp.Input = {}): void {
  server.registerTool("storybook", {
    title: "Storybook",
    description: "Открывает корневой вход Storybook MCP или направление по path. Ответ содержит назначение и children; у выбранного владельца input и output содержат JSON Schema с описаниями, а scenarios — примеры использования. Выберите направление по описанию и передайте его path следующему вызову. Пустой вызов или path: \".\" возвращает к неизменному root этого MCP-подключения. Адрес root — точка, адреса выбранного узла и children имеют вид ./путь и всегда отсчитываются от root, а не от последнего выбранного узла. Чтение не выполняет код. Используйте адреса из children, без параметров URL и фрагмента адреса.",
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
export function read(request: Parameters<StorybookAppMcp.Output["read"]>[0], options: Parameters<StorybookAppMcp.Output["read"]>[1]): ReturnType<StorybookAppMcp.Output["read"]> {
  return storybookRest(request, options)
}
