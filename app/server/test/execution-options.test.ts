import {expect, test} from "bun:test"
import {createExecutionOptions} from "../src/execution-options"

test("закрытие среды ожидает cleanup probe и не принимает новый запрос", async () => {
  const started = Promise.withResolvers<void>()
  const cleanup = Promise.withResolvers<void>()
  let prompts = 0
  const options = createExecutionOptions({project: "/fixture", toolRoot: "/fixture", async connect(input) {
    started.resolve()
    return {
      sessionId: "probe", capabilities: {}, configOptions: [],
      async setConfigOption() {return []}, async prompt() {prompts++; return {stopReason: "end_turn"}},
      async cancel() {}, async dispose() {await cleanup.promise},
    }
  }})
  const pending = options.read(undefined, new AbortController().signal)
  await started.promise
  let disposed = false
  const closing = options.dispose().then(() => {disposed = true})
  await Promise.resolve()
  expect(disposed).toBe(false)
  await expect(options.read(undefined, new AbortController().signal)).rejects.toThrow("закрыта")
  cleanup.resolve()
  await pending
  await closing
  expect(disposed).toBe(true)
  expect(prompts).toBe(0)
})

test("сбой подготовки Codex объясняет действие пользователя и сохраняет причину", async () => {
  const cause = new AggregateError([new Error("startup"), new Error("cleanup")], "ACP startup")
  const options = createExecutionOptions({project: "/fixture", toolRoot: "/fixture", async connect() {throw cause}})
  try {
    await options.read(undefined, new AbortController().signal)
    throw new Error("Ожидался отказ")
  } catch (error) {
    expect((error as Error).message).toBe("Не удалось завершить подключение к Codex. Повторите загрузку моделей")
    expect((error as Error).cause).toBe(cause)
  } finally {await options.dispose()}
})
