import type {Controller, ControllerResult} from "../contract/types"
import type {CallToolResult} from "@modelcontextprotocol/server"
import type {StorybookControllerAccessor} from "./resources"
import {resultContent, captureContent} from "./response"
import response from "@storybook-app-mcp/response"

export async function invoke(
  accessor: StorybookControllerAccessor,
  operation: (controller: Controller) => Promise<ControllerResult>,
): Promise<CallToolResult> {
  try {
    return resultContent(await operation(await accessor()))
  } catch (error) {
    return response.error(error)
  }
}

export async function invokeCapture(
  accessor: StorybookControllerAccessor,
  input: Parameters<Controller["capture"]>[0],
  signal: AbortSignal,
): Promise<CallToolResult> {
  try {
    const result = await (await accessor()).capture(input, {signal})
    return captureContent(result)
  } catch (error) {
    return response.error(error)
  }
}
