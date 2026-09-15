import type {CallToolResult} from "@modelcontextprotocol/server"
import type {StorybookCaptureResult} from "../../../server/controller-contract.ts"
import {sanitizeMcpString, sanitizeMcpValue} from "./public-boundary"

/** HTTP-ответ не получает MCP-ошибку из-за произвольного поля status в его данных. */
export function proxyContent(result: Readonly<Record<string, unknown>>): CallToolResult {
  const structuredContent = serializableRecord(result)
  return {content: [{type: "text", text: JSON.stringify(structuredContent)}], structuredContent}
}

export function resultContent(result: Readonly<Record<string, unknown>>): CallToolResult {
  const structuredContent = serializableRecord(result)
  return {
    content: [{type: "text", text: JSON.stringify(structuredContent)}],
    structuredContent,
    ...(result.status === "failed" || result.status === "timeout" || result.status === "unavailable"
      ? {isError: true}
      : {}),
  }
}

export function captureContent(result: StorybookCaptureResult): CallToolResult {
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

export function errorContent(error: unknown): CallToolResult {
  const name = error instanceof Error ? error.name : "Error"
  const message = sanitizeMcpString(error instanceof Error ? error.message : String(error)).slice(0, 4_096)
  const status = name === "TimeoutError" || name === "AbortError" ? "timeout" : "failed"
  return resultContent(Object.freeze({
    status,
    error: Object.freeze({code: name, message}),
  }))
}

function serializableRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error("Storybook controller result is not JSON-serializable")
  const parsed = sanitizeMcpValue(JSON.parse(serialized))
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Storybook controller result must be an object")
  }
  return parsed as Record<string, unknown>
}
