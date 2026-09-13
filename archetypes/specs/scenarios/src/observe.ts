/**
Наблюдает фактические вызовы, порядок начала и завершения.
Модули Bun Test не подменяются; обёртки устанавливаются только на импорты сценария.

@packageDocumentation
*/
import {currentContext} from "./context"
import {serialize} from "./serialize"
import {callLocation} from "./call-location"
import {queue} from "./pending"
import type {TraceCall, TraceOutcome, TraceValue} from "../contract/output"

type Registrar = (...args: unknown[]) => unknown
let nextCallId = 0
let nextCompletionId = 0
const wrapped = new WeakSet<Function>()

/** Отправляет запись после снимка аргументов и завершения возвращённого Promise. */
function sendCall(
  call: Omit<TraceCall, "args" | "outcome" | "completed">,
  args: Promise<readonly TraceValue[]>,
  completion: Promise<{readonly completed: number, readonly outcome: TraceOutcome}>,
): void {
  queue(Promise.all([args, completion]).then(([serializedArgs, {completed, outcome}]) => {
    process.send?.({type: "storybook:trace-call", call: {...call, completed, args: serializedArgs, outcome}})
  }))
}

/** Устанавливает наблюдение один раз на собственные методы результата, не меняя identity объекта. */
function attachMethods(module: string, name: string, value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value
  for (const method of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, method)
    if (!descriptor || typeof descriptor.value !== "function") continue
    if (wrapped.has(descriptor.value)) continue
    if (!descriptor.writable && !descriptor.configurable) continue
    const replacement = observe(module, `${name}.${method}`, descriptor.value as Registrar, false)
    wrapped.add(replacement)
    Object.defineProperty(value, method, {...descriptor, value: replacement})
  }
  return value
}

/** Оборачивает функцию и собственные методы её результата, сохраняя this и исходный Promise. */
export function observe(module: string, name: string, original: Registrar, methods = true): Registrar {
  return function(this: unknown, ...args: unknown[]) {
    const id = nextCallId++
    const active = currentContext()
    const call = {
      id,
      module,
      name,
      describe: active.describe,
      test: active.test,
      location: callLocation(new Error().stack),
    }
    const serializedArgs = serialize(args) as Promise<readonly TraceValue[]>
    try {
      const result = Reflect.apply(original, this, args)
      if (result instanceof Promise) {
        const completion = result.then(
          async value => ({
            completed: nextCompletionId++,
            outcome: {type: "resolve" as const, value: await serialize(methods ? attachMethods(module, name, value) : value)},
          }),
          async error => ({
            completed: nextCompletionId++,
            outcome: {type: "reject" as const, error: await serialize(error)},
          }),
        )
        sendCall(call, serializedArgs, completion)
      } else {
        if (methods) attachMethods(module, name, result)
        const completed = nextCompletionId++
        sendCall(call, serializedArgs, serialize(result).then(value => ({
          completed,
          outcome: {type: "return" as const, value},
        })))
      }
      return result
    } catch (error) {
      const completed = nextCompletionId++
      sendCall(call, serializedArgs, serialize(error).then(value => ({
        completed,
        outcome: {type: "throw" as const, error: value},
      })))
      throw error
    }
  }
}

