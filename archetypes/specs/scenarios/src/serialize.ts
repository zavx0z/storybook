/**
Переносит значения в JSON-совместимый снимок без выполнения getters.
Повторные ссылки и циклы сохраняются ссылками на первую запись объекта.
Каждый вызов serialize создаёт независимый снимок.

@packageDocumentation
*/
import type {TraceValue} from "./types"
import {matcherMetadata} from "./matcher-metadata"

/** Путь по закодированному снимку: ключи объектов и числовые индексы массивов. */
type ValuePath = readonly (string | number)[]

/**
Читает собственные enumerable properties; native hidden state не раскрывается.

@param value - Значение на момент создания снимка.
@returns Переносимые данные с однозначными ссылками внутри этого снимка.

@remarks
Обычные поля читаются до первого ожидания Promise. Результаты Promise читаются
после завершения с отдельной таблицей повторов: это другой момент наблюдения.
Внешние предки остаются доступны для обозначения циклов.
Объекты с собственным $type экранируются, чтобы не смешивать данные с метками.
*/
export async function serialize(value: unknown): Promise<TraceValue> {
  return capture(value, new Map(), [], new Map())
}

async function capture(
  value: unknown,
  seen: Map<object, ValuePath>,
  path: ValuePath,
  ancestors: ReadonlyMap<object, ValuePath>,
): Promise<TraceValue> {
  if (value === undefined) return {$type: "undefined"}
  if (typeof value === "bigint") return {$type: "bigint", value: String(value)}
  if (typeof value === "symbol") return {$type: "symbol", value: value.description ?? ""}
  if (typeof value === "function") return {$type: "function", name: value.name}
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value
  if (typeof value !== "object") return {$type: "unsupported", value: String(value)}
  const knownPath = seen.get(value)
  if (knownPath !== undefined) return {$type: "reference", path: [...knownPath]}
  seen.set(value, path)
  const nextAncestors = new Map(ancestors).set(value, path)
  const matcher = matcherMetadata(value)
  if (matcher) return {
    $type: "matcher", name: matcher.name, modifiers: [...matcher.modifiers],
    args: await capture(matcher.args, seen, [...path, "args"], nextAncestors),
  }
  if (value instanceof Promise) {
    try {
      return {
        $type: "promise",
        status: "fulfilled",
        value: await capture(await value, new Map(nextAncestors), [...path, "value"], nextAncestors),
      }
    } catch (error) {
      return {
        $type: "promise",
        status: "rejected",
        error: await capture(error, new Map(nextAncestors), [...path, "error"], nextAncestors),
      }
    }
  }
  if (value instanceof Error) return {
    $type: "error",
    name: value.name,
    message: value.message,
  }
  if (value instanceof Date) return {$type: "date", value: value.toISOString()}
  if (Array.isArray(value)) {
    return Promise.all(value.map((item, index) => capture(item, seen, [...path, index], nextAncestors)))
  }
  const keys = Object.keys(value)
  const escaped = keys.includes("$type")
  const propertiesPath = escaped ? [...path, "value"] : path
  const entries = await Promise.all(keys.map(async key => {
    const propertyPath = [...propertiesPath, key]
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor && (descriptor.get || descriptor.set)) return [key, {
        $type: "accessor",
        get: descriptor.get?.name ?? null,
        set: descriptor.set?.name ?? null,
      }] as const
      return [key, await capture(descriptor?.value, seen, propertyPath, nextAncestors)] as const
    } catch (error) {
      return [key, {
        $type: "unreadable",
        error: await capture(error, seen, [...propertyPath, "error"], nextAncestors),
      }] as const
    }
  }))
  const properties = Object.fromEntries(entries)
  return escaped ? {$type: "object", value: properties} : properties
}
