import type {Controller} from "../contract/types"
type StorybookCaptureResult = Awaited<ReturnType<Controller["capture"]>>
import type {CallToolResult} from "@modelcontextprotocol/server"
import response from "@zavx0z/storybook-app-mcp-response"

export function resultContent(result: Readonly<Record<string, unknown>>): CallToolResult {
  const content = response(result)
  return {
    ...content,
    ...(result.status === "failed" || result.status === "timeout" || result.status === "unavailable"
      ? {isError: true}
      : {}),
  }
}

export function captureContent(result: StorybookCaptureResult): CallToolResult {
  const {image, ...metadata} = result
  const content = response(metadata)
  const imageContent = image === undefined ? null : captureImage(image)
  return {
    content: [
      ...content.content,
      ...(imageContent === null ? [] : [imageContent]),
    ],
    structuredContent: content.structuredContent,
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
