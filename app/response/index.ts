/**
Очищает технические сведения из JSON до публикации в интерфейсе и журнале.
Предметный `status` остаётся данными и не подменяет признак ошибки доставки.

@packageDocumentation
*/
import type {Result} from "./contract/result"
import {sanitizePublicString, sanitizePublicText, sanitizePublicValue} from "./src/public-boundary"
import type {StorybookAppResponse} from "./contract"

export type {StorybookAppResponse} from "./contract"

/** Возвращает тот же очищенный объект в structuredContent и текстовом блоке. */
function proxyContent(result: StorybookAppResponse.Input): Result {
  const structuredContent = serializableRecord(result)
  return {content: [{type: "text", text: JSON.stringify(structuredContent)}], structuredContent}
}

/** Проверяет JSON-объект после сериализации и очистки публичной границы. */
function serializableRecord(value: StorybookAppResponse.Input): Record<string, unknown> {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error("Storybook controller result is not JSON-serializable")
  const parsed = sanitizePublicValue(JSON.parse(serialized))
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Storybook controller result must be an object")
  }
  return parsed as Record<string, unknown>
}

/** Сохраняет единую форму отказа для предметного, управляющего и HTTP-входа. */
function errorContent(error: unknown): Result {
  const name = error instanceof Error ? error.name : "Error"
  const message = sanitizePublicString(error instanceof Error ? error.message : String(error)).slice(0, 4_096)
  const status = name === "TimeoutError" || name === "AbortError" ? "timeout" : "failed"
  return {...proxyContent(Object.freeze({
    status,
    error: Object.freeze({code: name, message}),
  })), isError: true}
}

/** Одна вызываемая граница кодирования с её операциями очистки. */
const response: StorybookAppResponse.Output = Object.assign(proxyContent, {
  sanitizeString: sanitizePublicString,
  sanitizeValue: sanitizePublicValue,
  sanitizeText: sanitizePublicText,
  error: errorContent,
})

export default response
