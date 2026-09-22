import {expect, test} from "bun:test"
import {createScenarioRun} from "./scenario-run"

test("Клиент показывает вывод до завершения и читает разорванные UTF-8 сообщения", async () => {
  let writer!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({start(controller) { writer = controller }})
  const fetcher = (async (path: RequestInfo | URL) => String(path) === "/api/browser/session"
    ? Response.json({token: "test"})
    : new Response(body, {headers: {"content-type": "application/x-ndjson"}})) as typeof fetch
  const progress: string[] = []
  let complete = false
  const result = createScenarioRun(fetcher, "package", "node", "revision")(
    {id: "0", title: "Пример", source: "call()", calls: [], points: []}, new AbortController().signal,
    value => { if (value.text) progress.push(value.text) },
  ).then(value => {
    complete = true
    return value
  })
  const encoder = new TextEncoder()
  const bytes = encoder.encode(JSON.stringify({type: "progress", progress: {phase: "running", text: "Тест\n"}}) + "\n")
  for (const byte of bytes) writer.enqueue(Uint8Array.of(byte))
  await Bun.sleep(0)
  expect(progress).toEqual(["Тест\n"])
  expect(complete).toBeFalse()
  const final = {source: "call()", calls: [], points: [], execution: {status: "passed" as const, tests: []}}
  writer.enqueue(encoder.encode(JSON.stringify({type: "result", result: final}) + "\n"))
  writer.close()
  expect(await result).toEqual(final)
})

test("Оборванный поток не превращается в успешный результат", async () => {
  const fetcher = (async (path: RequestInfo | URL) => String(path) === "/api/browser/session"
    ? Response.json({token: "test"})
    : new Response('', {headers: {"content-type": "application/x-ndjson"}})) as typeof fetch
  await expect(createScenarioRun(fetcher, "package", "node", "revision")(
    {id: "0", title: "Пример", source: "call()", calls: [], points: []}, new AbortController().signal, () => {},
  )).rejects.toThrow("без результата")
})
