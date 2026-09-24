import {ResourceTemplate, type McpServer} from "@modelcontextprotocol/server"
import type {ExternalStorybookController, StorybookResourceResult} from "../../../server/controller-contract.ts"
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
      title: "Состояние Storybook",
      description: "Состояние единого сервера, реестра, сессий пакетов и представлений с ограничением объёма ответа.",
      mimeType: "application/json",
    },
    async (uri, context) => resourceContents(await read(controller, uri, context.mcpReq.signal)),
  )
  server.registerResource(
    "storybook-graph",
    "storybook://graph",
    {
      title: "Обзор графа Storybook",
      description: "Первая ограниченная страница единого графа деклараций.",
      mimeType: "application/json",
    },
    async (uri, context) => resourceContents(await read(controller, uri, context.mcpReq.signal)),
  )
  registerTemplate(
    server,
    controller,
    "storybook-package",
    "storybook://packages/{encodedPackageId}",
    "Состояние выбранного пакета Storybook и его структура в общем графе.",
  )
  registerTemplate(
    server,
    controller,
    "storybook-view",
    "storybook://views/{viewId}",
    "Состояние представления Storybook по его точному идентификатору.",
  )
  registerTemplate(
    server,
    controller,
    "storybook-capture",
    "storybook://captures/{captureId}",
    "PNG-снимок с ограничением объёма и сведения о его точной ревизии.",
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
