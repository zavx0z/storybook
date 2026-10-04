/**
Регистрирует предметное чтение, управление и ресурсы в одном native MCP server.
Предметные инструкции и структура ответа принадлежат HTTP-серверу.
Общая очистка служебных данных, один отложенный контроллер и обработка контекста
каждого запроса сохраняются на публичной границе MCP.
*/
import {McpServer} from "@modelcontextprotocol/server"
import {register} from "./subject"
import {registerStorybookResources} from "./resources"
import {
  storybookAttachSchema,
  storybookCaptureSchema,
  storybookCheckSchema,
  storybookCloseSchema,
  storybookDetachSchema,
  storybookEnsureSchema,
  storybookInspectSchema,
  storybookInteractSchema,
  storybookOpenSchema,
  storybookSearchSchema,
  storybookStatusSchema,
  storybookStopSchema,
  storybookWaitSchema,
  storybookRebuildWebSchema,
} from "./schemas"
import {recordMcpRequest, traceMcpRequest} from "./request-log"
import {controllerAccessor} from "./controller"
import {retainRequestLifetime} from "./lifetime"
import {invoke, invokeCapture} from "./invoke"
import createRequestProgress from "@zavx0z/storybook-tech-mcp-progress"
import type {Zavx0zStorybookAppMcp} from "../contract"

export function createServer(options: Zavx0zStorybookAppMcp.Input = {}): ReturnType<Zavx0zStorybookAppMcp.Output["createServer"]> {
  const server = new McpServer({name: "storybook", version: "1.0.0"})
  const run = retainRequestLifetime(server)
  const controller = controllerAccessor(options, run)
  /** Исполняет управляющую операцию с отменой и progress текущего MCP-запроса. */
  const execute: Parameters<NonNullable<Zavx0zStorybookAppMcp.Input["registerTools"]>>[1] = (operation, context) => {
    const notify = createRequestProgress(context)
    return run(() => invoke(controller, value => operation(value, {
      signal: context.mcpReq.signal,
      ...(notify === undefined ? {} : {onProgress: progress => notify(JSON.stringify(progress))}),
    })))
  }

  register(server, {
    ...(options.request === undefined ? {} : {request: options.request}),
    traceRequest: (tool, input, execute) => run(() => traceMcpRequest(
      tool, input, execute, options.recordRequest ?? recordMcpRequest, false,
    )),
  })

  server.registerTool("storybook_ensure", {
    title: "Запуск Storybook",
    description: "Запускает или использует действующий единый сервер Storybook и при необходимости атомарно подключает указанные корни.",
    inputSchema: storybookEnsureSchema,
    annotations: {idempotentHint: true},
  }, (input, context) => execute((value, operationContext) => value.ensure(input, operationContext), context))

  server.registerTool("storybook_status", {
    title: "Состояние Storybook",
    description: "Возвращает состояние сервера, реестра, сессий пакетов и при необходимости представлений, не запуская сервер.",
    inputSchema: storybookStatusSchema,
    annotations: {idempotentHint: true},
  }, async (input, context) => invoke(controller, (value) => value.status(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_attach", {
    title: "Подключение проекта к Storybook",
    description: "Добавляет пакет, проект или рабочее пространство в сохранённый каталог Storybook. Использует существующие записи и восстанавливает ранее удалённые ветви.",
    inputSchema: storybookAttachSchema,
  }, async (input, context) => invoke(controller, (value) => value.attach(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_detach", {
    title: "Удаление из каталога Storybook",
    description: "Удаляет одну ветвь проекта, пакета или рабочего пространства из сохранённого каталога Storybook и закрывает её представления. Файлы репозитория сохраняются.",
    inputSchema: storybookDetachSchema,
    annotations: {destructiveHint: true},
  }, async (input, context) => invoke(controller, (value) => value.detach(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_search", {
    title: "Поиск в Storybook",
    description: "Ищет в едином графе Storybook и возвращает ограниченную страницу результатов.",
    inputSchema: storybookSearchSchema,
    annotations: {readOnlyHint: true, idempotentHint: true},
  }, async (input, context) => invoke(controller, (value) => value.search(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_open", {
    title: "Открытие представления Storybook",
    description: "Открывает кандидата выбранного пакета в подходящей существующей или новой фоновой вкладке, сохраняя представления других пакетов.",
    inputSchema: storybookOpenSchema,
    annotations: {idempotentHint: true},
  }, async (input, context) => invoke(controller, (value) => value.open(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_wait", {
    title: "Ожидание состояния Storybook",
    description: "Ожидает указанного состояния ревизии пакета или представления по событиям.",
    inputSchema: storybookWaitSchema,
    annotations: {readOnlyHint: true},
  }, async (input, context) => invoke(controller, (value) => value.wait(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_inspect", {
    title: "Инспекция представления Storybook",
    description: "Возвращает состояние, диагностику, консоль, семантическое дерево, раскладку, Display или Canvas с ограничением объёма ответа.",
    inputSchema: storybookInspectSchema,
    annotations: {readOnlyHint: true, idempotentHint: true},
  }, async (input, context) => invoke(controller, (value) => value.inspect(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_interact", {
    title: "Взаимодействие со Storybook",
    description: "Выполняет ограниченное действие над семантической целью без координат, произвольного JavaScript и идентификаторов CDP.",
    inputSchema: storybookInteractSchema,
  }, async (input, context) => invoke(controller, (value) => value.interact(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_capture", {
    title: "Снимок представления Storybook",
    description: "Создаёт PNG-снимок выбранной отрисованной области и возвращает изображение вместе с ограниченным ресурсом результата.",
    inputSchema: storybookCaptureSchema,
    annotations: {readOnlyHint: true},
  }, async (input, context) => invokeCapture(controller, input, context.mcpReq.signal))

  server.registerTool("storybook_check", {
    title: "Проверка пакета Storybook",
    description: "Проверяет и собирает выбранный пакет, затем автоматически применяет успешный результат. Ошибка сохраняет рабочую версию. Ожидайте итог и наблюдайте прогресс через status; срока ожидания сборки нет.",
    inputSchema: storybookCheckSchema,
    annotations: {idempotentHint: true},
  }, (input, context) => execute((value, operationContext) => value.check(input, operationContext), context))

  server.registerTool("storybook_close", {
    title: "Закрытие представления Storybook",
    description: "Закрывает только одно представление пакета Storybook по его точному идентификатору.",
    inputSchema: storybookCloseSchema,
    annotations: {destructiveHint: true},
  }, async (input, context) => invoke(controller, (value) => value.close(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_stop", {
    title: "Остановка Storybook",
    description: "Явно останавливает только принадлежащий этому инструменту единый сервер Storybook. Требуется confirm=true.",
    inputSchema: storybookStopSchema,
    annotations: {destructiveHint: true, idempotentHint: true},
  }, async (input, context) => invoke(controller, (value) => value.stop(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_rebuild_web", {
    title: "Пересборка интерфейса Storybook",
    description: "Пересобирает только Web в готовой среде и автоматически публикует успешный результат для HMR. Ошибка сохраняет рабочую оболочку. Передаёт стадии до итогового ответа; срока ожидания сборки нет.",
    inputSchema: storybookRebuildWebSchema,
  }, (input, context) => execute((value, operationContext) => value.check({
    schemaVersion: 1,
    scope: "storybook:web",
  }, operationContext), context))

  registerStorybookResources(server, controller)
  options.registerTools?.(server, execute)
  return server
}
