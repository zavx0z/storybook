import {expect, test} from "bun:test"
import {streamScenarioRun} from "./scenario-stream"

test("Прогресс приходит до результата, отмена прекращает запуск", async () => {
  let signal: AbortSignal | undefined
  let finish!: () => void
  const response = streamScenarioRun(new AbortController().signal, async (current, onProgress) => {
    signal = current
    onProgress({phase: "running", text: "Проверяется первый пункт\n", stream: "stderr"})
    await new Promise<void>(resolve => { finish = resolve })
    return {done: true}
  })
  const reader = response.body!.getReader()
  const first = await reader.read()
  expect(new TextDecoder().decode(first.value)).toContain("Проверяется первый пункт")
  expect(signal!.aborted).toBeFalse()
  await reader.cancel()
  expect(signal!.aborted).toBeTrue()
  finish()
})

test("Поток различает итог и ошибку, ограничивая объём журнала", async () => {
  const response = streamScenarioRun(new AbortController().signal, async (_, onProgress) => {
    onProgress({phase: "running", text: "x".repeat(300_000)})
    onProgress({phase: "running", text: "late"})
    return {value: 1}
  })
  const text = await response.text()
  expect(text.length).toBeLessThan(270_000)
  const events = text.trim().split("\n").map(line => JSON.parse(line))
  expect(events.at(-1)).toEqual({type: "result", result: {value: 1}})
  expect(events.some(item => item.progress?.text.includes("предел журнала"))).toBeTrue()
  const failed = streamScenarioRun(new AbortController().signal, async () => { throw new Error("Ошибка запуска") })
  expect(JSON.parse((await failed.text()).trim())).toEqual({type: "error", error: "Ошибка запуска"})
})
