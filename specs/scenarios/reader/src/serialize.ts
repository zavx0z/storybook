/**
Ограниченный перенос значений trace без getters и Proxy traps.
Ссылки обозначают первый снимок объекта; результат Promise — отдельный момент.
Бюджет общий для наблюдения, включая поздние результаты Promise.

@packageDocumentation
*/
import {types} from "node:util"
import type {TraceValue} from "./types"
import {matcherMetadata} from "./matcher-metadata"

type ValuePath = readonly (string | number)[]
type Ancestor = {value: object; path: ValuePath; parent: Ancestor | null}
type Budget = {nodes: number; properties: number; strings: number; binary: number; deadline: number; identity: number}
type Property = {key: string; descriptor: PropertyDescriptor}
const limits = {depth: 16, nodes: 8192, properties: 16384, objectProperties: 128, arrayItems: 256,
  keyLength: 512, stringLength: 32768, stringCharacters: 524288, binaryBytes: 16 * 1024 * 1024, promiseMs: 50, durationMs: 250} as const
const nativeThen = Promise.prototype.then
const promiseSpecies = Object.getOwnPropertyDescriptor(Promise, Symbol.species)?.get
const bigintLimit = 10n ** BigInt(limits.stringLength)

/** Снимает обычные данные до первого ожидания и явно обозначает пропущенное. */
export async function serialize(value: unknown): Promise<TraceValue> {
  const budget: Budget = {nodes: 0, properties: 0, strings: 0, binary: 0, deadline: performance.now() + limits.durationMs, identity: 0}
  return capture(value, budget, new Map(), [], null, 0)
}

/** TraceCall.args и assertion.expected всегда остаются массивами, включая ранний budget exit. */
export async function serializeArguments(values: readonly unknown[]): Promise<readonly TraceValue[]> {
  const snapshot = await serialize(values)
  return Array.isArray(snapshot) ? snapshot : [snapshot]
}

function truncated(kind: string, reason: string, extra: Record<string, TraceValue> = {}): TraceValue {
  return {$type: "truncated", kind, reason, ...extra}
}

function text(value: string, budget: Budget): TraceValue {
  const maximum = Math.max(0, Math.min(limits.stringLength, limits.stringCharacters - budget.strings))
  budget.strings += Math.min(value.length, maximum)
  return value.length <= maximum ? value : truncated("string", "string-budget", {length: value.length, value: value.slice(0, maximum)})
}

function data(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && "value" in descriptor ? descriptor.value : undefined
}

function name(value: object): string {
  if (types.isProxy(value)) return "Proxy"
  const result = data(value, "name")
  return typeof result === "string" ? result.slice(0, 128) : ""
}

/** Узнаёт runtime форму до обхода её внутренних графов. */
function opaque(value: object): {kind: string; name: string} | null {
  if (typeof data(value, "render") === "function" && typeof data(value, "getProjection") === "function") return {kind: "runtime", name: "Root"}
  if (typeof data(value, "nodeType") === "number" && typeof data(value, "nodeName") === "string") return {kind: "dom", name: "Node"}
  if (typeof data(value, "createElement") === "function" && Object.getOwnPropertyDescriptor(value, "documentElement")) return {kind: "dom", name: "Document"}
  let prototype = Object.getPrototypeOf(value)
  for (let depth = 0; prototype !== null && depth < 8; depth++) {
    if (types.isProxy(prototype)) return {kind: "proxy", name: "ProxyPrototype"}
    const constructor = data(prototype, "constructor")
    const constructorName = typeof constructor === "function" ? name(constructor) : ""
    if (["Document", "Element", "Node", "Text", "DocumentFragment", "Window", "EventTarget", "Event", "Request", "Response",
      "ReadableStream", "WritableStream", "TransformStream", "AbortController", "AbortSignal", "WebSocket",
      "Renderer", "Object3D", "Space", "Mesh", "Line", "LineSegments", "GPUDevice", "GPUBuffer", "Map", "Set", "WeakMap", "WeakSet"].includes(constructorName)) {
      return {kind: ["Document", "Element", "Node", "Text", "DocumentFragment", "Window"].includes(constructorName) ? "dom" : "runtime", name: constructorName}
    }
    prototype = Object.getPrototypeOf(prototype)
  }
  return prototype === null ? null : {kind: "runtime", name: "PrototypeDepthLimit"}
}

function properties(value: object, budget: Budget): {values: Property[]; reason: string | null} {
  const values: Property[] = []
  let inspected = 0
  // Не создаёт в JS массив всех ключей широкого объекта, в отличие от Object.keys.
  for (const key in value) {
    if (performance.now() >= budget.deadline) return {values, reason: "time-budget"}
    if (++inspected > limits.objectProperties) return {values, reason: "property-budget"}
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable) continue
    if (values.length >= limits.objectProperties || budget.properties >= limits.properties) return {values, reason: "property-budget"}
    if (key.length > limits.keyLength || budget.strings + key.length > limits.stringCharacters) return {values, reason: "key-budget"}
    budget.properties++
    budget.strings += key.length
    values.push({key, descriptor})
  }
  return {values, reason: null}
}

async function capture(value: unknown, budget: Budget, seen: Map<object, ValuePath>, path: ValuePath, ancestor: Ancestor | null, depth: number): Promise<TraceValue> {
  const object = (typeof value === "object" && value !== null) || typeof value === "function"
  const matcher = object ? matcherMetadata(value) : null
  if (object && seen.has(value as object)) return {$type: "reference", path: seen.get(value as object)!}
  if (++budget.nodes > limits.nodes) return truncated("value", "node-budget")
  if (depth > limits.depth) return truncated("value", "depth-budget")
  if (performance.now() >= budget.deadline) return truncated("value", "time-budget")
  if (object && types.isProxy(value) && !matcher) {
    seen.set(value as object, path)
    return {$type: "opaque", kind: "proxy", name: "Proxy", id: ++budget.identity}
  }
  if (value === undefined) return {$type: "undefined"}
  if (typeof value === "bigint") return value >= bigintLimit || value <= -bigintLimit ? truncated("bigint", "string-budget") : {$type: "bigint", value: String(value)}
  if (typeof value === "symbol") return {$type: "symbol", value: text(value.description ?? "", budget)}
  if (typeof value === "function" && !matcher) return {$type: "function", name: name(value)}
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0) ? value
    : {$type: "number", value: Object.is(value, -0) ? "-0" : String(value)}
  if (typeof value === "string") return text(value, budget)
  if (value === null || typeof value === "boolean") return value
  if (!object) return {$type: "unsupported", value: String(value)}
  const target = value as object
  seen.set(target, path)
  const nextAncestor: Ancestor = {value: target, path, parent: ancestor}
  if (matcher) return {$type: "matcher", name: matcher.name, modifiers: [...matcher.modifiers], args: await capture(matcher.args, budget, seen, [...path, "args"], nextAncestor, depth + 1)}
  if (ArrayBuffer.isView(target) || types.isArrayBuffer(target) || types.isSharedArrayBuffer(target)) {
    const view = ArrayBuffer.isView(target)
    const dataView = types.isDataView(target)
    const prototype = dataView ? DataView.prototype : Object.getPrototypeOf(Uint8Array.prototype)
    const buffer = view ? Object.getOwnPropertyDescriptor(prototype, "buffer")!.get!.call(target) as ArrayBuffer : target as ArrayBuffer
    const offset = view ? Object.getOwnPropertyDescriptor(prototype, "byteOffset")!.get!.call(target) as number : 0
    const length = view ? Object.getOwnPropertyDescriptor(prototype, "byteLength")!.get!.call(target) as number
      : Object.getOwnPropertyDescriptor(types.isSharedArrayBuffer(target) ? SharedArrayBuffer.prototype : ArrayBuffer.prototype, "byteLength")!.get!.call(target) as number
    const kind = dataView ? "DataView" : Buffer.isBuffer(target) ? "Buffer"
      : view ? Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)!.get!.call(target) as string
        : types.isArrayBuffer(target) ? "ArrayBuffer" : "SharedArrayBuffer"
    if (budget.binary + length > limits.binaryBytes) return truncated("binary", "binary-budget", {name: kind, byteLength: length})
    budget.binary += length
    const encoded: Record<string, TraceValue> = {$type: "binary", name: kind, data: Buffer.from(buffer, offset, length).toString("base64")}
    // Большой TypedArray не перечисляется по byte/index ради дополнительных полей.
    if (view && !dataView && length > limits.objectProperties) encoded.properties = truncated("object", "binary-property-budget")
    else {
      const selected = properties(target, budget)
      selected.values = selected.values.filter(item => !view || dataView || !/^(0|[1-9]\d*)$/.test(item.key))
      if (selected.values.length || selected.reason) encoded.properties = await captureProperties(selected, budget, seen, [...path, "properties"], nextAncestor, depth + 1)
    }
    return encoded
  }
  if (types.isRegExp(target)) {
    const source = Object.getOwnPropertyDescriptor(RegExp.prototype, "source")!.get!.call(target) as string
    const flags = [["hasIndices", "d"], ["global", "g"], ["ignoreCase", "i"], ["multiline", "m"], ["dotAll", "s"], ["unicode", "u"], ["unicodeSets", "v"], ["sticky", "y"]]
      .filter(([key]) => Object.getOwnPropertyDescriptor(RegExp.prototype, key!)?.get?.call(target)).map(([, flag]) => flag).join("")
    const lastIndex = capture(data(target, "lastIndex"), budget, seen, [...path, "lastIndex"], nextAncestor, depth + 1)
    const selected = properties(target, budget)
    return {$type: "regexp", source: text(source, budget), flags, lastIndex: await lastIndex,
      ...(selected.values.length || selected.reason ? {properties: await captureProperties(selected, budget, seen, [...path, "properties"], nextAncestor, depth + 1)} : {})}
  }
  if (types.isPromise(target)) {
    if (Object.getPrototypeOf(target) !== Promise.prototype || Object.getOwnPropertyDescriptor(target, "constructor") ||
      data(Promise.prototype, "constructor") !== Promise || Object.getOwnPropertyDescriptor(Promise, Symbol.species)?.get !== promiseSpecies) return {$type: "opaque", kind: "runtime", name: "CustomPromise"}
    const wait = Math.max(0, Math.min(limits.promiseMs, budget.deadline - performance.now()))
    return settle(target, wait, {budget, path, ancestor: nextAncestor, depth})
  }
  if (types.isNativeError(target)) return {$type: "error", name: errorField(target, "name", "Error", budget), message: errorField(target, "message", "", budget)}
  if (types.isDate(target)) return {$type: "date", value: Date.prototype.toISOString.call(target)}
  const hidden = opaque(target)
  if (hidden) return {$type: "opaque", ...hidden, id: ++budget.identity}
  if (Array.isArray(target)) {
    const length = data(target, "length") as number
    const count = Math.min(length, limits.arrayItems, Math.max(0, limits.properties - budget.properties))
    const cut = count < length
    const items: Promise<TraceValue>[] = []
    for (let index = 0; index < count; index++) {
      budget.properties++
      const descriptor = Object.getOwnPropertyDescriptor(target, index)
      items[index] = descriptor ? property(descriptor, budget, seen, [...path, index], nextAncestor, depth + 1) : Promise.resolve(null)
    }
    const encoded = await Promise.all(items)
    // args остаётся массивом по публичному TraceCall protocol; marker не выдаёт tail за данные.
    if (cut) encoded.push(truncated("array-tail", "array-budget", {length, omitted: length - count}))
    return encoded
  }
  return captureProperties(properties(target, budget), budget, seen, path, nextAncestor, depth)
}

function accessor(descriptor: PropertyDescriptor): TraceValue {
  return {$type: "accessor", get: descriptor.get ? name(descriptor.get) : null, set: descriptor.set ? name(descriptor.set) : null}
}

function errorField(value: object, key: string, fallback: string, budget: Budget): TraceValue {
  let current: object | null = value
  for (let depth = 0; current !== null && depth < 8; depth++) {
    if (types.isProxy(current)) return {$type: "opaque", kind: "proxy", name: "ProxyPrototype"}
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor) return "value" in descriptor ? typeof descriptor.value === "string"
      ? text(descriptor.value, budget) : truncated("error-field", "non-string-value") : accessor(descriptor)
    current = Object.getPrototypeOf(current)
  }
  return fallback
}

function property(descriptor: PropertyDescriptor, budget: Budget, seen: Map<object, ValuePath>, path: ValuePath, ancestor: Ancestor, depth: number): Promise<TraceValue> {
  return "value" in descriptor ? capture(descriptor.value, budget, seen, path, ancestor, depth)
    : Promise.resolve(accessor(descriptor))
}

async function captureProperties(selected: {values: Property[]; reason: string | null}, budget: Budget, seen: Map<object, ValuePath>, path: ValuePath, ancestor: Ancestor, depth: number): Promise<TraceValue> {
  const escaped = selected.values.some(item => item.key === "$type")
  const prefix = [...path, ...(selected.reason ? ["value"] : []), ...(escaped ? ["value"] : [])]
  const entries = selected.values.map(({key, descriptor}) => property(descriptor, budget, seen, [...prefix, key], ancestor, depth + 1).then(result => [key, result] as const))
  const object = Object.fromEntries(await Promise.all(entries))
  const encoded = escaped ? {$type: "object", value: object} : object
  return selected.reason ? truncated("object", selected.reason, {value: encoded}) : encoded
}

type PromiseCapture = {budget: Budget; path: ValuePath; ancestor: Ancestor; depth: number}
type PromiseHolder = {state: PromiseCapture | null; resolve: (value: TraceValue) => void; timer: ReturnType<typeof setTimeout> | null}
function settled(holder: PromiseHolder, status: "fulfilled" | "rejected") {
  // Factory находится вне settle/capture: реакция удерживает только очищаемый holder.
  return (value: unknown) => {
    const state = holder.state
    if (state === null) return
    holder.state = null
    if (holder.timer !== null) clearTimeout(holder.timer)
    holder.timer = null
    const moment = new Map<object, ValuePath>()
    for (let current: Ancestor | null = state.ancestor; current !== null; current = current.parent) moment.set(current.value, current.path)
    const key = status === "fulfilled" ? "value" : "error"
    // Начинает снимок в самой реакции, до следующих мутаций после Promise.resolve().
    capture(value, state.budget, moment, [...state.path, key], state.ancestor, state.depth + 1).then(
      encoded => holder.resolve({$type: "promise", status, [key]: encoded}),
      () => holder.resolve({$type: "promise", status, [key]: truncated("value", "capture-failure")}),
    )
  }
}
function settle(value: Promise<unknown>, wait: number, state: PromiseCapture): Promise<TraceValue> {
  return new Promise(resolve => {
    const holder: PromiseHolder = {state, resolve, timer: null}
    holder.timer = setTimeout(() => {
      holder.state = null
      holder.timer = null
      resolve({$type: "promise", status: "pending", truncated: {reason: "promise-time-budget", limitMs: wait}})
    }, wait)
    nativeThen.call(value, settled(holder, "fulfilled"), settled(holder, "rejected"))
  })
}
