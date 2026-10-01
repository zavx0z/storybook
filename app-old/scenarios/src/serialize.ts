/**
Переносит значения в JSON-совместимый снимок; enumerable properties читает без выполнения getters.
Повторные ссылки и циклы сохраняются ссылками на первую запись объекта.
Каждый вызов serialize создаёт независимый снимок.

@packageDocumentation
*/
import type {TraceValue} from "./types"
import {matcherMetadata} from "./matcher-metadata"

/** Путь по закодированному снимку: ключи объектов и числовые индексы массивов. */
type ValuePath = readonly (string | number)[]

/**
Читает собственные enumerable properties и явно поддержанные специальные значения.

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
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0)
    ? value : {$type: "number", value: Object.is(value, -0) ? "-0" : String(value)}
  if (value === null || typeof value === "boolean" || typeof value === "string") return value
  if (typeof value !== "object") return {$type: "unsupported", value: String(value)}
  const knownPath = seen.get(value)
  if (knownPath !== undefined) return {$type: "reference", path: [...knownPath]}
  seen.set(value, path)
  const nextAncestors = new Map(ancestors).set(value, path)
  // Двоичные кадры и PNG сохраняются целиком, без Promise и поля JSON на каждый байт.
  if (ArrayBuffer.isView(value)) {
    const prototype = value instanceof DataView ? DataView.prototype : Object.getPrototypeOf(Uint8Array.prototype)
    const buffer = Object.getOwnPropertyDescriptor(prototype, "buffer")!.get!.call(value) as ArrayBuffer
    const offset = Object.getOwnPropertyDescriptor(prototype, "byteOffset")!.get!.call(value) as number
    const length = Object.getOwnPropertyDescriptor(prototype, "byteLength")!.get!.call(value) as number
    const name = value instanceof DataView ? "DataView" : Buffer.isBuffer(value) ? "Buffer"
      : Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)!.get!.call(value) as string
    const data = Buffer.from(buffer, offset, length).toString("base64")
    const keys = Object.keys(value).filter(key => value instanceof DataView || !/^(0|[1-9]\d*)$/u.test(key))
    return {
      $type: "binary", name, data,
      ...(keys.length ? {properties: await captureProperties(value, seen, [...path, "properties"], nextAncestors, keys)} : {}),
    }
  }
  if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) {
    const data = Buffer.from(value).toString("base64")
    const keys = Object.keys(value)
    return {
      $type: "binary", name: value instanceof ArrayBuffer ? "ArrayBuffer" : "SharedArrayBuffer", data,
      ...(keys.length ? {properties: await captureProperties(value, seen, [...path, "properties"], nextAncestors, keys)} : {}),
    }
  }
  if (value instanceof RegExp) {
    // Native getters читают внутреннее состояние, не вызывая переопределённые свойства объекта.
    const source = Object.getOwnPropertyDescriptor(RegExp.prototype, "source")!.get!.call(value) as string
    const flags = [
      ["hasIndices", "d"], ["global", "g"], ["ignoreCase", "i"], ["multiline", "m"],
      ["dotAll", "s"], ["unicode", "u"], ["unicodeSets", "v"], ["sticky", "y"],
    ].filter(([key]) => Object.getOwnPropertyDescriptor(RegExp.prototype, key!)?.get?.call(value))
      .map(([, flag]) => flag).join("")
    const lastIndex = capture(Object.getOwnPropertyDescriptor(value, "lastIndex")?.value, seen, [...path, "lastIndex"], nextAncestors)
    const properties = Object.keys(value).length ? captureProperties(value, seen, [...path, "properties"], nextAncestors) : undefined
    return {
      $type: "regexp", source, flags,
      lastIndex: await lastIndex,
      ...(properties === undefined ? {} : {properties: await properties}),
    }
  }
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
    const items = new Array<Promise<TraceValue>>(value.length)
    for (let index = 0; index < items.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index)
      if (!descriptor) continue
      items[index] = "value" in descriptor
        ? capture(descriptor.value, seen, [...path, index], nextAncestors)
        : Promise.resolve({
          $type: "accessor",
          get: descriptor.get?.name ?? null,
          set: descriptor.set?.name ?? null,
        })
    }
    return Promise.all(items)
  }
  return captureProperties(value, seen, path, nextAncestors)
}

/** Сохраняет собственные поля обычного объекта или дополнительные поля специального значения. */
async function captureProperties(
  value: object,
  seen: Map<object, ValuePath>,
  path: ValuePath,
  ancestors: ReadonlyMap<object, ValuePath>,
  keys = Object.keys(value),
): Promise<TraceValue> {
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
      return [key, await capture(descriptor?.value, seen, propertyPath, ancestors)] as const
    } catch (error) {
      return [key, {
        $type: "unreadable",
        error: await capture(error, seen, [...propertyPath, "error"], ancestors),
      }] as const
    }
  }))
  const properties = Object.fromEntries(entries)
  return escaped ? {$type: "object", value: properties} : properties
}
