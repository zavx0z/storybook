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
    description: "Читает зарегистрированные пакеты Storybook. Пустой запрос показывает корневые пакеты. node — точный адрес пакета через /, без query, fragment и внутренних директорий. Ответ может перечислять только вложенные пакеты; внутренняя структура пока не раскрывается.",
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
    title: "Ensure external Storybook",
    description: "Start or reuse the one canonical Storybook server and atomically attach optional roots.",
    inputSchema: storybookEnsureSchema,
    annotations: {idempotentHint: true},
  }, async (input, context) => invoke(controller, (value) => value.ensure(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_status", {
    title: "Read Storybook status",
    description: "Read canonical server, registry, package-session and optional view state without starting it.",
    inputSchema: storybookStatusSchema,
    annotations: {idempotentHint: true},
  }, async (input, context) => invoke(controller, (value) => value.status(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_attach", {
    title: "Attach Storybook declaration root",
    description: "Add a package, project or workspace to the saved Storybook catalog. Reuses existing entries and restores previously removed branches.",
    inputSchema: storybookAttachSchema,
  }, async (input, context) => invoke(controller, (value) => value.attach(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_detach", {
    title: "Detach Storybook scope",
    description: "Remove one project, package or workspace branch from the saved Storybook catalog and close its package views. Repository files are preserved.",
    inputSchema: storybookDetachSchema,
    annotations: {destructiveHint: true},
  }, async (input, context) => invoke(controller, (value) => value.detach(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_search", {
    title: "Search Storybook graph",
    description: "Search the canonical graph with bounded pagination.",
    inputSchema: storybookSearchSchema,
    annotations: {readOnlyHint: true, idempotentHint: true},
  }, async (input, context) => invoke(controller, (value) => value.search(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_open", {
    title: "Open Storybook package view",
    description: "Preview an exact package candidate in an existing matching tab or a new background tab; preserve other packages.",
    inputSchema: storybookOpenSchema,
    annotations: {idempotentHint: true},
  }, async (input, context) => invoke(controller, (value) => value.open(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_wait", {
    title: "Wait for Storybook state",
    description: "Wait event-first for an exact package/view revision condition.",
    inputSchema: storybookWaitSchema,
    annotations: {readOnlyHint: true},
  }, async (input, context) => invoke(controller, (value) => value.wait(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_inspect", {
    title: "Inspect Storybook view",
    description: "Read bounded state, diagnostics, console, semantic, layout, display or canvas projection.",
    inputSchema: storybookInspectSchema,
    annotations: {readOnlyHint: true, idempotentHint: true},
  }, async (input, context) => invoke(controller, (value) => value.inspect(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_interact", {
    title: "Interact with Storybook view",
    description: "Perform a bounded semantic action without raw coordinates, JavaScript or CDP identity.",
    inputSchema: storybookInteractSchema,
  }, async (input, context) => invoke(controller, (value) => value.interact(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_capture", {
    title: "Capture Storybook view",
    description: "Capture an exact rendered region as PNG image content and a bounded artifact resource.",
    inputSchema: storybookCaptureSchema,
    annotations: {readOnlyHint: true},
  }, async (input, context) => invokeCapture(controller, input, context.mcpReq.signal))

  server.registerTool("storybook_check", {
    title: "Check Storybook package",
    description: "Build a package candidate. With live=true, inspect the exact candidate and apply it on success to all tabs of that package; preserve the applied revision on failure.",
    inputSchema: storybookCheckSchema,
    annotations: {idempotentHint: true},
  }, async (input, context) => invoke(controller, (value) => value.check(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_close", {
    title: "Close Storybook view",
    description: "Close only one exact opaque Storybook package view.",
    inputSchema: storybookCloseSchema,
    annotations: {destructiveHint: true},
  }, async (input, context) => invoke(controller, (value) => value.close(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_stop", {
    title: "Stop external Storybook",
    description: "Explicitly stop only the owned canonical Storybook server. Requires confirm=true.",
    inputSchema: storybookStopSchema,
    annotations: {destructiveHint: true, idempotentHint: true},
  }, async (input, context) => invoke(controller, (value) => value.stop(input, {signal: context.mcpReq.signal})))

  registerStorybookResources(server, controller)
  return server
}
