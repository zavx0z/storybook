import {ResourceTemplate, type McpServer} from "@modelcontextprotocol/server"
import type {ExternalStorybookController, StorybookResourceResult} from "../src/external/browser-control/types.ts"
import {sanitizeMcpString, sanitizeMcpText, sanitizeMcpValue} from "./public-boundary.ts"

export type StorybookControllerAccessor = () => Promise<ExternalStorybookController>

export function registerStorybookResources(
  server: McpServer,
  controller: StorybookControllerAccessor,
): void {
  server.registerResource(
    "storybook-state",
    "storybook://state",
    {
      title: "External Storybook state",
      description: "Bounded canonical server, registry, package-session and view state.",
      mimeType: "application/json",
    },
    async (uri, context) => resourceContents(await read(controller, uri, context.mcpReq.signal)),
  )
  server.registerResource(
    "storybook-graph",
    "storybook://graph",
    {
      title: "External Storybook graph summary",
      description: "Bounded first page of the canonical declaration graph.",
      mimeType: "application/json",
    },
    async (uri, context) => resourceContents(await read(controller, uri, context.mcpReq.signal)),
  )
  registerTemplate(
    server,
    controller,
    "storybook-package",
    "storybook://packages/{encodedPackageId}",
    "Exact Storybook package state and structural graph projection.",
  )
  registerTemplate(
    server,
    controller,
    "storybook-view",
    "storybook://views/{viewId}",
    "Exact opaque Storybook browser view state.",
  )
  registerTemplate(
    server,
    controller,
    "storybook-capture",
    "storybook://captures/{captureId}",
    "Bounded PNG capture artifact and exact revision metadata.",
  )
}

function registerTemplate(
  server: McpServer,
  controller: StorybookControllerAccessor,
  name: string,
  template: string,
  description: string,
): void {
  server.registerResource(
    name,
    new ResourceTemplate(template, {list: undefined}),
    {description},
    async (uri, _variables, context) => resourceContents(await read(controller, uri, context.mcpReq.signal)),
  )
}

async function read(
  accessor: StorybookControllerAccessor,
  uri: URL,
  signal: AbortSignal,
): Promise<StorybookResourceResult> {
  try {
    const controller = await accessor()
    return await controller.readResource(uri.href, {signal})
  } catch (error) {
    return Object.freeze({
      status: error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)
        ? "timeout"
        : "failed",
      uri: uri.href,
      mimeType: "application/json",
      error: Object.freeze({
        code: error instanceof Error ? error.name : "Error",
        message: sanitizeMcpString(error instanceof Error ? error.message : String(error)).slice(0, 4_096),
      }),
    })
  }
}

function resourceContents(result: StorybookResourceResult) {
  if (result.status !== "success") {
    const error = sanitizeMcpValue(
      result.error ?? {code: result.status, message: `Storybook resource ${result.status}`},
    )
    return {
      contents: [{
        uri: result.uri,
        mimeType: "application/json",
        text: JSON.stringify({status: result.status, error}),
      }],
    }
  }
  if (result.blob !== undefined) {
    return {
      contents: [{uri: result.uri, mimeType: result.mimeType, blob: result.blob}],
    }
  }
  return {
    contents: [{
      uri: result.uri,
      mimeType: result.mimeType,
      text: sanitizeMcpText(result.text ?? "", result.mimeType),
    }],
  }
}
