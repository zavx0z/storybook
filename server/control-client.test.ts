import {afterEach, expect, test} from "bun:test"
import {ExternalStorybookControlClient} from "./control-client.ts"
import type {ExternalStorybookServerRecord} from "./server-state.ts"

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
const client = new ExternalStorybookControlClient({
  origin: "http://127.0.0.1:43210",
  instanceId: "fixture",
  controlToken: "x".repeat(43),
} as ExternalStorybookServerRecord)

test("NDJSON сохраняет стадии, UTF-8 и итог через произвольные границы chunks", async () => {
  const received: unknown[] = []
  const progress = {phase: "Подготовка", at: 17, operationId: "web-1"}
  const expected = {ok: true, applied: false, web: {phase: "prepared"}}
  const bytes = new TextEncoder().encode(`${JSON.stringify({type: "progress", progress})}\n${JSON.stringify({type: "result", result: expected})}`)
  let request: RequestInit | undefined
  const signal = new AbortController().signal
  globalThis.fetch = Object.assign(async (_url: unknown, init?: RequestInit) => {
    request = init
    return new Response(new ReadableStream({
      start(controller) {
        for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3))
        controller.close()
      },
    }), {headers: {"content-type": "application/x-ndjson"}})
  }, {preconnect: originalFetch.preconnect})
  const result = await client.controlStream("/api/control/app/web/rebuild", {live: true}, value => { received.push(value) }, signal)
  expect(result).toEqual(expected)
  expect(received).toEqual([progress])
  expect(request?.signal).toBe(signal)
  expect(request?.headers).toMatchObject({accept: "application/x-ndjson", authorization: `Bearer ${"x".repeat(43)}`})
})

test.each([
  {source: '{"type":"error","error":"Ошибка Web"}\n', message: "Ошибка Web"},
  {source: '{"type":"progress","progress":{"phase":"start"}}\n', message: "ended without a result"},
  {source: '{"type":"unexpected"}\n', message: "invalid event"},
])("отказ потока раскрывается без status polling: $message", async ({source, message}) => {
  globalThis.fetch = Object.assign(async () => new Response(source, {headers: {"content-type": "application/x-ndjson"}}), {preconnect: originalFetch.preconnect})
  await expect(client.controlStream("/api/control/app/web/rebuild", {})).rejects.toThrow(message)
})

test("отмена отсоединяет клиентский поток ожидания", async () => {
  const firstProgress = Promise.withResolvers<void>()
  let cancelled = false
  globalThis.fetch = Object.assign(async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"type":"progress","progress":{"phase":"start"}}\n'))
    },
    cancel() { cancelled = true },
  }), {headers: {"content-type": "application/x-ndjson"}}), {preconnect: originalFetch.preconnect})
  const abort = new AbortController()
  const pending = client.controlStream("/api/control/app/web/rebuild", {}, () => { firstProgress.resolve() }, abort.signal)
  await firstProgress.promise
  abort.abort(new DOMException("Прекращено ожидание", "AbortError"))
  await expect(pending).rejects.toThrow("Прекращено ожидание")
  expect(cancelled).toBeTrue()
})

test("JSON fallback возвращает тот же результат", async () => {
  globalThis.fetch = Object.assign(async () => Response.json({ok: true, published: false}), {preconnect: originalFetch.preconnect})
  expect(await client.controlStream("/api/control/app/web/rebuild", {})).toEqual({ok: true, published: false})
})
