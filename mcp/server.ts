import {McpServer, type CallToolResult} from "@modelcontextprotocol/server"
import type {
  ExternalStorybookController,
  StorybookCaptureResult,
  StorybookControllerResult,
} from "../src/external/browser-control/types.ts"
import {registerStorybookResources, type StorybookControllerAccessor} from "./resources.ts"
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
} from "./schemas.ts"
import {sanitizeMcpString, sanitizeMcpValue} from "./public-boundary.ts"

export type CreateStorybookMcpServerOptions = Readonly<{
  controller?: ExternalStorybookController
  controllerFactory?: () => ExternalStorybookController | Promise<ExternalStorybookController>
}>

export function createStorybookMcpServer(options: CreateStorybookMcpServerOptions = {}): McpServer {
  const controller = controllerAccessor(options)
  const server = new McpServer({name: "storybook", version: "1.0.0"})

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
    annotations: {readOnlyHint: true, idempotentHint: true},
  }, async (input, context) => invoke(controller, (value) => value.status(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_attach", {
    title: "Attach Storybook declaration root",
    description: "Atomically attach one standalone package, project or workspace declaration root.",
    inputSchema: storybookAttachSchema,
  }, async (input, context) => invoke(controller, (value) => value.attach(input, {signal: context.mcpReq.signal})))

  server.registerTool("storybook_detach", {
    title: "Detach Storybook scope",
    description: "Detach only one exact declaration subtree and its package views.",
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
    description: "Reuse or open the one opaque browser view for an exact package route.",
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
    description: "Validate declarations, graph, build and optionally live activation with structured diagnostics.",
    inputSchema: storybookCheckSchema,
    annotations: {readOnlyHint: true, idempotentHint: true},
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

function controllerAccessor(options: CreateStorybookMcpServerOptions): StorybookControllerAccessor {
  let pending: Promise<ExternalStorybookController> | null = null
  return () => {
    pending ??= Promise.resolve(options.controller ?? options.controllerFactory?.() ?? loadCanonicalController())
      .then(validateController)
      .catch((error) => {
        pending = null
        throw error
      })
    return pending
  }
}

async function loadCanonicalController(): Promise<ExternalStorybookController> {
  const moduleUrl = new URL("../src/external/controller.ts", import.meta.url)
  const namespace = await import(moduleUrl.href) as Record<string, unknown>
  const factory = namespace.createExternalStorybookController
  if (typeof factory !== "function") {
    throw new Error("Canonical Storybook controller does not export createExternalStorybookController()")
  }
  return validateController(await factory())
}

function validateController(value: unknown): ExternalStorybookController {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("External Storybook controller must be an object")
  }
  const controller = value as Record<string, unknown>
  for (const method of [
    "ensure",
    "status",
    "attach",
    "detach",
    "search",
    "open",
    "wait",
    "inspect",
    "interact",
    "capture",
    "check",
    "close",
    "stop",
    "readResource",
  ]) {
    if (typeof controller[method] !== "function") throw new Error(`External Storybook controller is missing ${method}()`)
  }
  return value as ExternalStorybookController
}

async function invoke(
  accessor: StorybookControllerAccessor,
  operation: (controller: ExternalStorybookController) => Promise<StorybookControllerResult>,
): Promise<CallToolResult> {
  try {
    return resultContent(await operation(await accessor()))
  } catch (error) {
    return errorContent(error)
  }
}

async function invokeCapture(
  accessor: StorybookControllerAccessor,
  input: Parameters<ExternalStorybookController["capture"]>[0],
  signal: AbortSignal,
): Promise<CallToolResult> {
  try {
    const result = await (await accessor()).capture(input, {signal})
    return captureContent(result)
  } catch (error) {
    return errorContent(error)
  }
}

function resultContent(result: StorybookControllerResult): CallToolResult {
  const structuredContent = serializableRecord(result)
  return {
    content: [{type: "text", text: JSON.stringify(structuredContent)}],
    structuredContent,
    ...(result.status === "failed" || result.status === "timeout" || result.status === "unavailable"
      ? {isError: true}
      : {}),
  }
}

function captureContent(result: StorybookCaptureResult): CallToolResult {
  const {image, ...metadata} = result
  const structuredContent = serializableRecord(metadata)
  const imageContent = image === undefined ? null : captureImage(image)
  return {
    content: [
      {type: "text", text: JSON.stringify(structuredContent)},
      ...(imageContent === null ? [] : [imageContent]),
    ],
    structuredContent,
    ...(result.status === "failed" || result.status === "timeout" || result.status === "unavailable"
      ? {isError: true}
      : {}),
  }
}

function captureImage(image: NonNullable<StorybookCaptureResult["image"]>) {
  if (image.mimeType !== "image/png" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(image.data) || image.data.length > 128 * 1024 * 1024) {
    throw new Error("Storybook controller returned an invalid PNG image content block")
  }
  return {type: "image" as const, data: image.data, mimeType: "image/png" as const}
}

function errorContent(error: unknown): CallToolResult {
  const name = error instanceof Error ? error.name : "Error"
  const message = sanitizeMcpString(error instanceof Error ? error.message : String(error)).slice(0, 4_096)
  const status = name === "TimeoutError" || name === "AbortError" ? "timeout" : "failed"
  return resultContent(Object.freeze({
    status,
    error: Object.freeze({code: name, message}),
  }))
}

function serializableRecord(value: StorybookControllerResult): Record<string, unknown> {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error("Storybook controller result is not JSON-serializable")
  const parsed = sanitizeMcpValue(JSON.parse(serialized))
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Storybook controller result must be an object")
  }
  return parsed as Record<string, unknown>
}
