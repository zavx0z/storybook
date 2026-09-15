import type {CallToolResult} from "@modelcontextprotocol/server"
import type {ExternalStorybookController, StorybookControllerResult} from "../../../server/controller-contract.ts"
import type {StorybookControllerAccessor} from "./resources"
import {resultContent, errorContent, captureContent} from "./response"

export async function invoke(
  accessor: StorybookControllerAccessor,
  operation: (controller: ExternalStorybookController) => Promise<StorybookControllerResult>,
): Promise<CallToolResult> {
  try {
    return resultContent(await operation(await accessor()))
  } catch (error) {
    return errorContent(error)
  }
}

export async function invokeCapture(
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
