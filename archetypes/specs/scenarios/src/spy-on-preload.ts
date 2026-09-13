import * as bunTest from "bun:test"

const originalSpyOn = bunTest.spyOn
const spies: Array<{name: string, read: () => unknown}> = []

await bunTest.mock.module("bun:test", () => ({
  ...bunTest,
  spyOn: (...args: unknown[]) => {
    const spy = Reflect.apply(originalSpyOn, undefined, args) as {mock: unknown}
    spies.push({name: String(args[1]), read: () => spy.mock})
    return spy
  },
}))

/** Передаёт через JSON также undefined, функции, циклы и состояние Promise. */
async function snapshot(value: unknown, seen = new Set<object>()): Promise<unknown> {
  if (value === undefined) return {type: "undefined"}
  if (typeof value === "function") return {type: "function", name: value.name}
  if (typeof value === "bigint") return {type: "bigint", value: String(value)}
  if (value === null || typeof value !== "object") return value
  if (seen.has(value)) return {type: "circular"}
  const next = new Set(seen).add(value)
  if (value instanceof Promise) {
    return value.then(async result => ({type: "promise", status: "fulfilled", value: await snapshot(result, next)}),
      async error => ({type: "promise", status: "rejected", value: await snapshot(error, next)}))
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => snapshot(item, next)))
  return Object.fromEntries(await Promise.all(Object.getOwnPropertyNames(value).map(async key => [key, await snapshot(Reflect.get(value, key), next)])))
}

bunTest.afterAll(async () => {
  const path = process.env.STORYBOOK_SPY_REPORT
  if (!path) throw new Error("Не задан путь отчёта spyOn")
  const history = await Promise.all(spies.map(async spy => ({name: spy.name, history: await snapshot(spy.read())})))
  await Bun.write(path, JSON.stringify(history))
})
