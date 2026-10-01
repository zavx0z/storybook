/**
Очищает технические сведения из непрозрачного JSON до публикации через MCP.
Успешный предметный `status` остаётся данными и не меняет transport isError.

@packageDocumentation
*/
import type {CallToolResult} from "@modelcontextprotocol/server"
import {sanitizeMcpString, sanitizeMcpText, sanitizeMcpValue} from "./src/public-boundary"
import type {AppMcpResponse} from "./contract"

export type {AppMcpResponse} from "./contract"

/** Возвращает тот же очищенный объект в structuredContent и текстовом блоке. */
function proxyContent(result: AppMcpResponse.Input): CallToolResult {
  const structuredContent = serializableRecord(result)
  return {content: [{type: "text", text: JSON.stringify(structuredContent)}], structuredContent}
}

/** Проверяет JSON-объект после сериализации и очистки публичной границы. */
function serializableRecord(value: AppMcpResponse.Input): Record<string, unknown> {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error("Storybook controller result is not JSON-serializable")
  const parsed = sanitizeMcpValue(JSON.parse(serialized))
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Storybook controller result must be an object")
  }
  return parsed as Record<string, unknown>
}

/** Сохраняет единую форму отказа для предметного, управляющего и HTTP-входа. */
function errorContent(error: unknown): CallToolResult {
  const name = error instanceof Error ? error.name : "Error"
  const message = sanitizeMcpString(error instanceof Error ? error.message : String(error)).slice(0, 4_096)
  const status = name === "TimeoutError" || name === "AbortError" ? "timeout" : "failed"
  return {...proxyContent(Object.freeze({
    status,
    error: Object.freeze({code: name, message}),
  })), isError: true}
}

/** Одна вызываемая граница кодирования с её операциями очистки. */
const response: AppMcpResponse.Output = Object.assign(proxyContent, {
  sanitizeString: sanitizeMcpString,
  sanitizeValue: sanitizeMcpValue,
  sanitizeText: sanitizeMcpText,
  error: errorContent,
})

export default response
