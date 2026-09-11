import {expect, test} from "bun:test"
import {preparingHtmlResponse} from "./preparing-html.ts"

test("HTML transport отвечает до окончания очереди и затем отдаёт один документ", async () => {
  let finish!: (html: string) => void
  const gate = new Promise<string>(resolve => { finish = resolve })
  const response = preparingHtmlResponse(() => gate, {"content-type": "text/html"}, new AbortController().signal, 10)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  expect(decoder.decode((await reader.read()).value)).toContain("waiting for scheduled")
  finish("<!doctype html><html>Workbench</html>")
  let html = ""
  for (;;) {
    const next = await reader.read()
    if (next.done) break
    html += decoder.decode(next.value)
  }
  expect(html.match(/<!doctype html>/g)).toHaveLength(1)
  expect(html).toContain("Workbench")
})

test("отмена клиента закрывает ожидание без управления общей сборкой", async () => {
  const controller = new AbortController()
  let finish!: (html: string) => void
  const gate = new Promise<string>(resolve => { finish = resolve })
  const response = preparingHtmlResponse(() => gate, {}, controller.signal, 10)
  const reader = response.body!.getReader()
  await reader.read()
  controller.abort()
  expect((await reader.read()).done).toBe(true)
  finish("late HTML")
})
