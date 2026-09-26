/**
Подключает HTTP-прокси и существующие управляющие инструменты к протоколу MCP.
Предметные инструкции и структура ответа принадлежат HTTP-серверу.
Общая очистка служебных данных сохраняется на публичной границе MCP.

@packageDocumentation
*/
import {McpServer} from "@modelcontextprotocol/server"
import {registerStorybookResources} from "./src/resources"
import {
  storybookSchema,
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
} from "./src/schemas"
import {requestStorybook} from "../proxy"
import {recordMcpRequest, traceMcpRequest} from "./src/request-log"
import {controllerAccessor} from "./src/controller"
import {proxyContent, errorContent} from "./src/response"
import {invoke, invokeCapture} from "./src/invoke"
import type {CreateStorybookMcpServerInput} from "./contract/input"
import type {CreateStorybookMcpServerOutput} from "./contract/output"

export type {CreateStorybookMcpServerInput, CreateStorybookMcpServerOutput}

export function createStorybookMcpServer(options: CreateStorybookMcpServerInput = {}): CreateStorybookMcpServerOutput {
  const controller = controllerAccessor(options)
  const server = new McpServer({name: "storybook", version: "1.0.0"})

  server.registerTool("storybook", {
    title: "Storybook",
    description: "Открывает корневой вход Storybook MCP или направление по path. Ответ содержит назначение и children; у выбранного владельца input и output содержат JSON Schema с описаниями, а scenarios — примеры использования. Выберите направление по описанию и передайте его path следующему вызову. Пустой вызов возвращает к корню. Чтение не выполняет код. Используйте адреса из children, без параметров URL и фрагмента адреса.",
    inputSchema: storybookSchema,
    annotations: {readOnlyHint: true, idempotentHint: true},
  }, async (input, context) => {
    try {
      return proxyContent(await traceMcpRequest("storybook", input,
        () => (options.request ?? requestStorybook)(input, context.mcpReq.signal), options.recordRequest ?? recordMcpRequest, false))
    } catch (error) {
      return errorContent(error)
    }
  })

  server.registerTool("storybook_ensure", {
    title: "Запуск Storybook",
    description: "Запускает или использует действующий единый сервер Storybook и при необходимости атомарно подключает указанные корни.",
    inputSchema: storybookEnsureSchema,
    annotations: {idempotentHint: true},
  }, async (input, context) => invoke(controller, (value) => value.ensure(input, {signal: context.mcpReq.signal})))

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
    description: "Собирает кандидата пакета. При live=true проверяет его и в случае успеха применяет ко всем вкладкам этого пакета. При ошибке сохраняет применённую ревизию.",
    inputSchema: storybookCheckSchema,
    annotations: {idempotentHint: true},
  }, async (input, context) => invoke(controller, (value) => value.check(input, {signal: context.mcpReq.signal})))

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

  registerStorybookResources(server, controller)
  return server
}
