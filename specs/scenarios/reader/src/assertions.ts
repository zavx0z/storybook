import {currentContext} from "./context"
import {serialize} from "./serialize"
import {queue} from "./pending"
import type {ScenarioAssertion, TraceLocation} from "./types"

const records: Promise<ScenarioAssertion>[] = []

/** Сохраняет каждый вызов native matcher, не меняя его результат или исключение. */
export function observeExpect(site: string, location: TraceLocation, original: (...args: unknown[]) => unknown) {
  return (...args: unknown[]) => {
    const active = currentContext()
    const actual = serialize(args[0])
    const wrap = (target: object, modifiers: string[]): object => new Proxy(target, {
      get(object, key) {
        const value = Reflect.get(object, key, object)
        if (typeof key === "string" && ["not", "resolves", "rejects"].includes(key)) return wrap(value, [...modifiers, key])
        if (typeof key !== "string" || !key.startsWith("to") || typeof value !== "function") return value
        return (...expected: unknown[]) => {
          const id = records.length
          const expectedValues = serialize(expected)
          let finish!: (outcome: {status: "passed" | "failed", error: unknown}) => void
          const completed = new Promise<{status: "passed" | "failed", error: unknown}>(resolve => { finish = resolve })
          records.push(completed.then(async outcome => ({
            id, site, describe: [...active.describe], test: active.test, testId: active.testId,
            customFailMessage: typeof args[1] === "string" ? args[1] : null,
            actual: await actual, matcher: key, modifiers,
            expected: await expectedValues as ScenarioAssertion["expected"],
            status: outcome.status, error: await serialize(outcome.error), location,
          })))
          try {
            const result = Reflect.apply(value, object, expected)
            if (result instanceof Promise) {
              queue(result.then(() => finish({status: "passed", error: null}), error => finish({status: "failed", error})))
            } else finish({status: "passed", error: null})
            return result
          } catch (error) {
            finish({status: "failed", error})
            throw error
          }
        }
      },
    })
    return wrap(Reflect.apply(original, undefined, args) as object, [])
  }
}

/** Возвращает завершённые наблюдения в порядке вызова matcher. */
export async function readAssertions(): Promise<readonly ScenarioAssertion[]> {
  return Promise.all(records)
}
