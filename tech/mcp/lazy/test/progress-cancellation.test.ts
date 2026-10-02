import {expect, test} from "bun:test"
import {existsSync, readFileSync} from "node:fs"
import {join} from "node:path"
import {connectLazyFixture, createLazyFixture, waitFor} from "./fixture"

test("ordered progress принадлежит outer request token; отмена одной работы сохраняет другую", async () => {
  const fixture = createLazyFixture()
  const connection = await connectLazyFixture(fixture)
  try {
    const progress: unknown[] = []
    await connection.client.callTool({name: "hold", arguments: {id: "progress", delayMs: 30}}, {
      onprogress: event => { progress.push(event) },
    })
    const sent = connection.requests.find(message => "method" in message && message.method === "tools/call" &&
      message.params?.arguments !== undefined && (message.params.arguments as {id?: unknown}).id === "progress")
    if (!sent || !("params" in sent)) throw new Error("Native tools/call отсутствует в transport")
    const token = (sent.params?._meta as {progressToken?: unknown} | undefined)?.progressToken
    expect(token, "Native SDK назначает progressToken родительскому запросу").toBeDefined()
    const wireProgress = connection.notifications.flatMap(message =>
      "method" in message && message.method === "notifications/progress" ? [message.params] : [])
    expect(wireProgress, "Порядок, total и token принадлежат тому же outer tools/call в MCP transport")
      .toEqual([
        {progressToken: token, progress: 1, total: 2, message: "progress:started"},
        {progressToken: token, progress: 2, total: 2, message: "progress:complete"},
      ])
    expect(progress, "SDK callback получает progress без служебного token")
      .toEqual([
        {progress: 1, total: 2, message: "progress:started"},
        {progress: 2, total: 2, message: "progress:complete"},
      ])

    const canceled = new AbortController()
    const cancelResult = connection.client.callTool({name: "hold", arguments: {id: "cancelled", delayMs: 3000}}, {
      signal: canceled.signal,
    }).then(value => ({value, error: null}), error => ({value: null, error}))
    const survivor = connection.client.callTool({name: "hold", arguments: {id: "survivor", delayMs: 1000}})
    await waitFor(() => existsSync(join(fixture.root, "cancelled.started")) &&
      existsSync(join(fixture.root, "survivor.started")), "Параллельные handlers не начали работу")
    canceled.abort(new DOMException("Отменён только первый запрос", "AbortError"))
    expect((await cancelResult).error, "Client получает отказ отменённого запроса").not.toBeNull()
    await waitFor(() => existsSync(join(fixture.root, "cancelled.cleanup")), "Отмена не доставила handler signal/cleanup")
    expect(readFileSync(join(fixture.root, "cancelled.cleanup"), "utf8"), "finally получил отменённый AbortSignal")
      .toBe("aborted")
    expect((await survivor).structuredContent, "Отмена первого запроса не завершает независимый второй")
      .toEqual({id: "survivor", done: true})
    expect(readFileSync(join(fixture.root, "survivor.cleanup"), "utf8")).toBe("completed")
    expect((await connection.client.callTool({name: "echo", arguments: {text: "still-connected"}})).structuredContent)
      .toEqual({version: "v1", value: "still-connected"})
  } finally {
    await connection.close()
    fixture.dispose()
  }
}, 30_000)
