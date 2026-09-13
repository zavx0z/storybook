/**
Переносит значения в JSON-совместимый отчёт без выполнения getters.
Promise, ошибки, функции и циклы представлены явными метками.

@packageDocumentation
*/
import type {TraceValue} from "../contract/output"

/** Читает собственные enumerable properties; native hidden state не раскрывается. */
export async function serialize(value: unknown, seen = new Map<object, string>(), path = "$"): Promise<TraceValue> {
  if (value === undefined) return {$type: "undefined"}
  if (typeof value === "bigint") return {$type: "bigint", value: String(value)}
  if (typeof value === "symbol") return {$type: "symbol", value: value.description ?? ""}
  if (typeof value === "function") return {$type: "function", name: value.name}
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value
  if (typeof value !== "object") return {$type: "unsupported", value: String(value)}
  const knownPath = seen.get(value)
  if (knownPath) return {$type: "reference", path: knownPath}
  const next = new Map(seen).set(value, path)
  if (value instanceof Promise) {
    try {
      return {$type: "promise", status: "fulfilled", value: await serialize(await value, next, `${path}.value`)}
    } catch (error) {
      return {$type: "promise", status: "rejected", error: await serialize(error, next, `${path}.error`)}
    }
  }
  if (value instanceof Error) return {
    $type: "error",
    name: value.name,
    message: value.message,
  }
  if (value instanceof Date) return {$type: "date", value: value.toISOString()}
  if (Array.isArray(value)) return Promise.all(value.map((item, index) => serialize(item, next, `${path}[${index}]`)))
  const entries = await Promise.all(Object.keys(value).map(async key => {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor && (descriptor.get || descriptor.set)) return [key, {
        $type: "accessor",
        get: descriptor.get?.name ?? null,
        set: descriptor.set?.name ?? null,
      }] as const
      return [key, await serialize(descriptor?.value, next, `${path}.${key}`)] as const
    } catch (error) {
      return [key, {$type: "unreadable", error: await serialize(error, next, `${path}.${key}.error`)}] as const
    }
  }))
  return Object.fromEntries(entries)
}

