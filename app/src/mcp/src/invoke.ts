import {type StorybookApp as StorybookAppContract} from "@storybook/app"
type StorybookControllerResult = Awaited<ReturnType<StorybookAppContract.Output["ensure"]>>
import type {CallToolResult} from "@modelcontextprotocol/server"
import type {StorybookControllerAccessor} from "./resources"
import {resultContent, captureContent} from "./response"
import response from "@app-mcp/response"

export async function invoke(
  accessor: StorybookControllerAccessor,
  operation: (controller: StorybookAppContract.Output) => Promise<StorybookControllerResult>,
): Promise<CallToolResult> {
  try {
    return resultContent(await operation(await accessor()))
  } catch (error) {
    return response.error(error)
  }
}

export async function invokeCapture(
  accessor: StorybookControllerAccessor,
  input: Parameters<StorybookAppContract.Output["capture"]>[0],
  signal: AbortSignal,
): Promise<CallToolResult> {
  try {
    const result = await (await accessor()).capture(input, {signal})
    return captureContent(result)
  } catch (error) {
    return response.error(error)
  }
}
